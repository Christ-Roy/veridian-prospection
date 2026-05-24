# [PROSPECTION] Formaliser la convention `e2e/extended/` vs `e2e/` racine

> **Sévérité** : 🟢 P2 — convention non-documentée qui a causé des doublons silencieux. Hygiène repo.
> **Owner** : agent Prospection
> **Créé** : 2026-05-23
> **Découvert par** : agent e2e-17-specs (qui a dû supprimer 10 doublons)

## Le problème

Le repo a 3 conventions de placement de specs E2E :

```
e2e/core/        — 6 specs, BLOQUANTS deploy (cf .claude/rules/core-tests.md)
e2e/extended/    — 23+ specs, NON-BLOQUANTS, 3 browsers parallel
e2e/             — racine, ~24 specs encore présentes
e2e/_deprecated/ — anti-patterns archivés
e2e/staging-full/ — journeys headfull lourds (skill ui-polish-team)
e2e/integration/ — tenant isolation (Prisma + Postgres)
e2e/migrations/  — versionnée
```

**Aucune doc** ne précise QUI doit aller OÙ. Résultat : pendant
l'audit du ticket Supabase, j'ai trouvé **9 paires** `e2e/X.spec.ts`
↔ `e2e/extended/X.spec.ts` strictement identiques byte-pour-byte (7
paires) ou quasi-identiques (1 paire `invite-flow` diff = chemin
import).

→ Quelqu'un a copié/migré sans supprimer l'original, et personne ne
l'a vu pendant ~2 mois. Tous ces tests tournaient en double dans la
CI (3 browsers x 2 fichiers x 2 retries = waste compute massif).

## Pourquoi c'est gênant

1. **Compute CI gâché** : 2x les workers Playwright pour le même test.
2. **Maintenance double** : un fix dans `extended/` n'arrive pas dans la
   racine (cf le diff `regression.spec.ts` où core/ avait des fixes
   429 que la racine n'avait pas).
3. **Confusion agents** : un nouvel agent ne sait pas où mettre une
   nouvelle spec. Il copie l'existant → reproduit le pattern.
4. **Migration risque** : si une spec a une copie qu'on oublie de
   migrer en parallèle (cas typique du ticket Supabase 2026-05-22),
   on croit avoir tout fait alors qu'une moitié dérive.

## Fix proposé — 2 actions

### 1. Documenter la convention dans `e2e/README.md`

Créer `e2e/README.md` (n'existe pas) avec :

```markdown
# Tests E2E Veridian Prospection

## Convention de placement

- **`core/`** — Tests bloquants pour le deploy. ≤6 specs, ≤60s total.
  Le squelette absolu (health, login, prospects list, auth gate).
  Modifs ici = revue extra-attentive (cf `.claude/rules/core-tests.md`).

- **`extended/`** — Tests fonctionnels non-bloquants. 1 feature = 1
  spec ici. Pattern : login `e2e-persistent` + navigation + assertions
  métier. Tourne sur 3 browsers en CI.

- **`staging-full/`** — Journeys lourds headfull (UI polish, screenshots).
  Pilotés par le skill `ui-polish-team`. Ne pas mettre de spec
  fonctionnelle ici.

- **`integration/`** — Tests Prisma directs (tenant isolation, multi-row
  queries). Pas de browser.

- **`migrations/`** — Tests versionnés (état d'une migration DB).

- **`_deprecated/`** — Archive. Ne plus modifier, ne plus exécuter.
  À supprimer après audit (sprint dette).

- **Racine `e2e/`** — INTERDIT pour nouvelles specs. Migrer toute
  spec racine vers `extended/` ou `core/` selon criticité.

## Helper canonique

Tous les tests qui ont besoin d'auth importent
`loginAsE2EUser` depuis `e2e/helpers/auth.ts`. Ne JAMAIS ré-implémenter
de login Supabase/Auth.js inline (cf incident ticket
2026-05-22-e2e-helper-auth-supabase-mort.md).
```

### 2. Migrer le reste des specs racine vers `extended/`

Audit après migration Supabase : il reste ~14 specs en racine `e2e/`
(hors `_deprecated/`) qui ont déjà un doublon dans `extended/` OU
qui devraient y être :

```
e2e/admin-pages-v1.spec.ts      — doublon extended/
e2e/api-siren.spec.ts           — pas de doublon, à move vers extended/
e2e/auth-flows.spec.ts          — pas de doublon, à move vers extended/
e2e/browser-flow.spec.ts        — déjà migré (helper canonique), garder
                                  ou move extended/
e2e/client-error-boundary.spec.ts — doublon extended/
e2e/dashboard-crawler.spec.ts   — pas de doublon, à move vers extended/
e2e/empty-states.spec.ts        — pas de doublon, à move vers extended/
e2e/error-boundaries.spec.ts    — pas de doublon, à move vers extended/
e2e/filters-persistence.spec.ts — doublon extended/
e2e/global-full-flow.spec.ts    — pas de doublon, à move vers extended/
e2e/historique-page.spec.ts     — doublon extended/
e2e/invited-member-flow.spec.ts — doublon core/
e2e/keyboard-shortcuts-help.spec.ts — doublon extended/
e2e/lead-detail-interactions.spec.ts — doublon extended/
e2e/onboarding-flow.spec.ts     — pas de doublon, à move vers extended/
e2e/pipeline-kanban.spec.ts     — pas de doublon, à move vers extended/
e2e/prospects-full-flow.spec.ts — pas de doublon, à move vers extended/
e2e/search-prospects.spec.ts    — doublon extended/
e2e/segments-filter.spec.ts     — doublon extended/
e2e/settings-page.spec.ts       — doublon extended/
e2e/status-endpoint.spec.ts     — doublon core/
e2e/stripe-checkout.spec.ts     — pas de doublon, à move vers extended/
e2e/ui-siren-smoke.spec.ts      — pas de doublon, garder ou move extended/
```

**Process** :
1. Pour les doublons : `diff` byte-pour-byte → si identique, supprimer
   la version racine. Si différent, merger les améliorations dans la
   version `extended/` ou `core/` puis supprimer racine.
2. Pour les non-doublons : `git mv e2e/X.spec.ts e2e/extended/X.spec.ts`.
3. Mettre à jour les références dans `docs/CI-STRATEGY.md`,
   `docs/INVITE-FLOW.md`, `shared/infra/prod-clone/clone-prod-test.sh`
   (submodule infra, coordonner avec l'agent infra).

## Périmètre

- Création `e2e/README.md` (documentation)
- Suppression / move des ~23 specs racine
- Update des refs dans docs/ et scripts

**Ne pas toucher** au code `src/` ni aux workflows CI (sauf si un
workflow référence un chemin spécifique, à fixer).

## Validation post-fix

```bash
# Aucune spec en racine e2e/ (uniquement les sous-dossiers)
find e2e -maxdepth 1 -name "*.spec.ts" | wc -l  # → 0

# Tous les imports helpers fonctionnent encore
grep -rn 'from "../helpers/auth"\|from "./helpers/auth"' e2e/ | wc -l
# (chiffre stable avant/après)

# Run smoke d'un échantillon
ssh dev-pub 'docker run --rm --network staging-edge -v /tmp/e2e:/work -w /work \
  ... mcr.microsoft.com/playwright:v1.60.0-jammy \
  npx playwright test e2e/extended/ e2e/core/ --project=chromium --reporter=list'
```

## Effort

~3h. La majorité = `diff` + `git mv` + mise à jour refs docs. Pas de
logique métier à reécrire (sauf merge éventuel des diffs sur doublons
non-identiques).

## Lien

Suite logique du ticket `2026-05-22-e2e-specs-auth-supabase-inline.md`
qui a déjà éliminé 10 doublons. Ce ticket-ci finit le job (~13 specs
racine restantes) et **documente la convention** pour éviter que le
problème revienne.
