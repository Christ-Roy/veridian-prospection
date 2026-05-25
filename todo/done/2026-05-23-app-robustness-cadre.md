# [PROSPECTION] Robustesse app — cadre maître + chantiers prioritaires

> **Type** : Cadre / vision robustesse + index des chantiers
> **Sévérité** : 🔴 P0 (vision globale, casser un fil = casser silencieusement la prod)
> **Owner** : team-lead Prospection
> **Créé** : 2026-05-23
> **Demandeur** : Robert — « il faut vraiment qu'on ait des tests pour tester toute l'app, il y a des trous dans Husky, je veux une app robuste »

## Constat

L'incident invitations 2026-05-23 (Supabase mort 5 jours en silence) a prouvé que **la couverture de tests Vitest unitaire ne suffit pas** à attraper les régressions critiques. Ressources :

- **97 fichiers dans `tests-pending.txt`** = dette assumée mais qui mord (chaque fichier non-testé peut devenir une bombe)
- **CI crawler `dashboard-crawler.spec.ts` cassé depuis 2026-05-22** (`DATABASE_URL` manquant en CI — ticket déjà déposé)
- **Zéro E2E flow entier cross-app** (invitation, login Hub→Prosp, switch compte, provision, welcome leads)
- **Husky a 7 checks** mais aucun ne vérifie : qu'un test PROUVE qu'il détecte (sabotage), qu'un endpoint répond à son contrat documenté, qu'un appel cross-app cible un endpoint qui existe encore.

## Cartographie des angles morts — état 2026-05-23

### Husky pre-push aujourd'hui (7 checks actifs)

| Check | Détecte | Aurait attrapé le bug invitations 2026-05-23 ? |
|---|---|---|
| `check-test-mapping.sh` | 1 source modifiée = 1 test modifié | ❌ — `invitations.ts` était en `tests-pending.txt` |
| `check-route-safety.sh` | `request.json` sans try/catch, `/api/admin/*` sans `requireAdmin` | ❌ — pas une route |
| `check-secrets.sh` | Stripe/AWS/GitHub keys dans le diff | ❌ — pas un secret |
| `check-deps-cve.sh` | npm audit critical/high prod | ❌ — pas une dep |
| `check-hygiene.sh` | gros fichiers, console.log dans src/ | ❌ — pas un signal |
| `check-env-sync.sh` | `process.env.X` non déclaré dans .env.example | ❌ — au contraire, les SUPABASE_* étaient déclarées (mort doc) |
| `check-ui-build.sh` | `npm run build` casse + intégrité .next/ | ❌ — build OK, l'appel runtime à `/auth/v1/admin/*` plante en prod uniquement |

**Conclusion : aucun de nos 7 checks ne détecte un appel HTTP runtime vers un endpoint mort.**

### `tests-pending.txt` par catégorie

| Catégorie | Compte | Risque |
|---|---|---|
| `src/components/dashboard/` | 25 | 🟢 UI — sprint pattern source-level couvre |
| `src/components/` (layout/ui/divers) | 37 | 🟢 UI — idem |
| **`src/lib/`** (hors queries) | **32** | 🔴 **CRITIQUE** — auth, audit, cache, billing, helpers business |
| `src/lib/queries/` | 7 | 🔴 CRITIQUE — accès DB direct, hot path |
| `src/hooks/` | 3 | 🟡 P1 — hooks React partagés |
| `src/app/api/` | 0 | ✅ OK — toutes les routes ont leur test (mais le test ne couvre pas tout, cf E2E flows) |

### Trous conceptuels (pas dans tests-pending — invisibles)

1. **Aucun test ne PROUVE qu'il détecte** — un test qui assert `expect(true).toBe(true)` est compté comme "test présent". Sabotage-test manuel obligatoire mais non vérifié.
2. **Aucune couverture de branches mesurée** — un if/else sur 4 chemins testé sur 1 chemin = "couvert" pour Husky.
3. **Aucun smoke contractuel cross-app** — un endpoint Hub qui retourne désormais un format différent ne casse Prosp qu'en runtime.
4. **Aucun check de drift Prisma vs DB réelle** — `results` et `segment_catalog` existent en prod prosp mais pas dans `schema.prisma` (cf ticket P5).
5. **Aucun E2E flow entier** — invitation, login Hub→Prosp, switch compte, provision, welcome leads — testés bout en bout uniquement à la main.

## Plan robustesse — état 2026-05-23 22h

### ✅ Chantier 1 — `src/lib/` couverture business — LIVRÉ
→ `todo/done/2026-05-23-tests-lib-business-coverage.md`
Helpers auth, queries, billing, cache, audit couverts. Voir archive.

### ✅ Chantier 2 — E2E flows entiers cross-app — LIVRÉ
→ `todo/done/2026-05-23-e2e-coverage-flows-entiers.md`
Agent T vague 5 (commit c6a0d20 prod 3f927ef) — 7 flows e2e cross-app livrés dans `e2e/flows-cross-app/` + `scripts/e2e/flows-cross-app.sh` + sabotage validé en 16s. Voir archive.

**🎉 LES 4 CHANTIERS DU CADRE SONT LIVRÉS EN PROD.** Ce ticket cadre peut être archivé.

### ✅ Chantier 3 — Nouveaux checks Husky — LIVRÉ
→ `todo/done/2026-05-23-husky-nouveaux-checks-robustesse.md`
Les 3 nouveaux scripts pre-push sont câblés. Voir archive.

### ✅ Chantier 4 — Crawler CI réparation — LIVRÉ
→ `todo/done/2026-05-22-fix-crawler-database-url-staging-ci.md`
Crawler tourne dans container Playwright sur dev-pub avec accès DB. Voir archive.

## Chantiers connexes ajoutés post-cadre (suite incident 2026-05-23)

- `todo/2026-05-23-maj-mega-battery-e2e-staging.md` — **GATE de toute promo prod post-commercialisation** (10 zones à couvrir)
- `todo/2026-05-23-persist-client-errors-db.md` — observability frontend (savoir si un fix défensif marche en prod)
- `todo/2026-05-23-audit-defensif-setters-async.md` — 3 patterns suspects identiques au bug fixé
- `todo/2026-05-23-renforcer-11-tests-routes-api-faibles.md` — sabotage VERT sur 11 routes critiques

## Métriques de succès

Cette mission est finie quand on peut dire :

- [ ] **`tests-pending.txt` < 30 lignes** (dette résiduelle uniquement composants UI cosmétiques)
- [ ] **`src/lib/` 100% couvert** (0 fichier business sans test)
- [ ] **7 flows E2E entiers passent** sur staging + sont lancés à chaque push CI
- [ ] **3 nouveaux checks Husky** câblés + sabotage-testés
- [ ] **Casser volontairement `invitations.ts` (= retour à Supabase mort)** doit rougir au moins UN test ET un check Husky avant prod

## Pourquoi P0

Le bug invitations a duré 5 jours en silence parce qu'aucun test n'a hurlé. Tant qu'on ne couvre pas le hot path, on peut avoir un autre bug du même genre demain. C'est précisément ce que Robert veut éviter.

## Pilotage

- **Team-lead** : pilote le cadre, sérialise les push, valide chaque chantier
- **4 agents** : un par chantier (lib-tests, e2e-flows, husky-new-checks, crawler-fix déjà lancé)
- **Cadence** : chantiers 1+3 parallèles cette passe, chantier 2 sur 2-3 sprints (gros), chantier 4 en cours

## Référence

- Hotfix invitations 2026-05-23 : commit `a5f38c0`
- Audit Supabase résiduel 2026-05-23 : commit `a43ba33` (0 bombe trouvée, le grep était trompeur — `invitations.ts` était isolé)
- Convention tickets : `todo/README.md`
