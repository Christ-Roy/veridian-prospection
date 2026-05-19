# Audit dette technique Prospection — 2026-05-19

> **Auteur** : Agent Prospection (session 2026-05-19)
> **Périmètre** : repo `veridian-prospection` uniquement (autres apps = audit séparé)
> **Méthode** : grep exhaustif + smoke staging DB prod clonée + diff schéma DB vs Prisma
> **Objectif** : tickets actionnables ranked ROI/risque pour réduire la dette à zéro

Total estimation : **3-4 jours focus dev**, en sprints atomiques shippable
indépendamment. Aucune des opérations n'est urgente — prod fonctionne. Mais
chaque mois passé sans cleanup = plus dur à fermer.

---

## P0 — Bombes à retardement (à fixer avant la giga-MAJ prod)

### P0.1 — Migrations 0004 + 0005 pas appliquées en prod ✅ DONE 2026-05-19

**Vérification post-giga-MAJ** : `_prisma_migrations` prod liste 0001→0005
finished_at à 16:24-16:25 (appliquées via `prisma migrate deploy` du CI
compose-up). Colonnes `plan/plan_source/purge_eligible_at/last_touched_at/purged_at`
présentes dans `tenants` prod. Smoke 3 endpoints lifecycle (update-plan,
soft-delete, usage-summary) → 401 Unauthorized propre (HMAC rejette avant DB,
pas de P2022). Constat du ticket obsolète : la giga-MAJ d'hier soir
a tout réglé.

<details>
<summary>Constat initial (obsolète)</summary>

**Constat** : prod DB n'a aucune des colonnes `plan`, `plan_source`,
`purge_eligible_at`, `last_touched_at`, `purged_at`. Code applicatif déployé
(commit `f780c5a` P2.2 mergé sur main) référence ces colonnes via Prisma.
**Update-plan retourne 500 P2022 silencieusement en prod actuellement** (vu
au curl manuel — Hub n'appelle pas encore l'endpoint donc personne n'a vu).

**Fix** :
1. Baseline `_prisma_migrations` sur DB prod (manque comme staging — clone
   ancien sans la table de tracking) : `prisma migrate resolve --applied`
   pour 0001/0002/0003
2. `prisma migrate deploy` → applique 0004 + 0005 (additif only, ADD COLUMN
   nullable, instantané sur 11 lignes, zero downtime)
3. Re-smoke /update-plan, /soft-delete, /usage-summary en prod = 4xx propre

**Validation pré-prod** : déjà fait sur DB staging clonée prod (cf smoke
2026-05-19 — 24 scénarios pass). Migration testée, idempotente, validée.

**Quand** : avant toute giga-MAJ Robert. Action humaine déclenchée explicite.

</details>

### P0.2 — `ensureOwnerAdmin` dans provision = code Supabase mort ✅ DONE 2026-05-19

**Refactor** : `ensureOwnerAdmin(email)` (155 lignes Supabase + Prisma) →
`ensureOwnerWorkspace(userId, email)` (90 lignes Prisma pure). Suppression de
`getSupabaseAdminClient`, du cache userIdCache, du dual-write Supabase tenants,
de la pagination listUsers. Import `@supabase/supabase-js` viré du fichier.
Tests provision : 11/11 verts. Ticket de coordination ouvert dans
`veridian-hub/todo/2026-05-19-prospection-provision-user-id.md` pour que le
Hub envoie `user_id` (sans quoi le workspace setup reste skip avec warning).

Diff : `-201 / +75` (~126 lignes nettes supprimées).

<details>
<summary>Constat initial</summary>

**Fichier** : `src/app/api/tenants/provision/route.ts:39-193` (~155 lignes).
La fonction appelle `admin.auth.admin.listUsers`, `admin.from("tenants").insert`
et fait un dual-write Prisma. La branche Supabase admin **ne tourne jamais**
en prod (les ENV `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` ne sont plus
provisionnées) — la fonction warn "skipping auto-admin" et retourne. Mais
le code complet (155 lignes) est exécuté pour rien à chaque provision.

**Effets** :
- 155 lignes de code mort dans le hot path
- 12s de timeout potentiel si quelqu'un re-câble Supabase ENV par erreur
- 1 dep `@supabase/supabase-js` retenue pour rien

**Fix** :
1. Extraire la logique Prisma propre (workspace default + member owner)
   dans un helper `ensureOwnerWorkspace(userId, email)` qui utilise **uniquement**
   Prisma — sans Supabase admin
2. Câbler ce helper dans le flow `provision` à la place de l'actuel
3. Supprimer `getSupabaseAdminClient()` + branche Supabase
4. Smoke : un signup Hub → provision Prospection doit toujours créer un
   workspace default avec l'owner

**Estim** : 1h30 (la logique Prisma existe déjà dans la fonction, juste
extraire).

</details>

---

## P1 — Supabase legacy global (49 fichiers à virer)

### P1.1 — Inventaire surface Supabase

```
src/ qui importent @supabase :  12 fichiers
src/ qui importent @/lib/supabase :  27 fichiers
scripts/ qui touchent Supabase :  9 fichiers
tests/e2e qui touchent Supabase :  46 fichiers
package.json : @supabase/ssr ^0.10.0 + @supabase/supabase-js ^2.101.0
```

ENV vars encore référencées :
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SMTP_CONFIGURED`

### P1.2 — Distinction critique : 2 types de fichiers `lib/supabase/*`

| Fichier | Vrai usage Supabase ? | Action |
|---|---|---|
| `src/lib/supabase/server.ts` | OUI — `createServerClient`, cookies, getUser | À **supprimer** (Auth.js fait ça maintenant) |
| `src/lib/supabase/api-auth.ts` | OUI — `supabase.auth.getUser` + **fallback dangereux** `{ id: "internal" }` si ENV absent | À **supprimer**, helpers Auth.js existent dans `src/lib/auth/` |
| `src/lib/supabase/middleware.ts` | OUI — cookies session Supabase | À **supprimer** |
| `src/lib/supabase/user-context.ts` | OUI — getUser + tenant resolution | À **supprimer**, déjà migré dans `src/lib/auth/user-context.ts` (lui est canonique) |
| `src/lib/supabase/tenant.ts` | **NON** — N'utilise QUE Prisma | À **renommer** `src/lib/tenant.ts` (mal rangé) |

### P1.3 — Risque sécu critique dans `api-auth.ts`

`src/lib/supabase/api-auth.ts:22-25` :

```ts
if (!supabaseUrl || !supabaseAnonKey) {
  // No Supabase configured — allow (internal tool mode)
  return { user: { id: "internal", email: "internal@localhost" } };
}
```

**Si quelqu'un retire SUPABASE_* des ENV avant de virer ce fichier, toutes
les routes qui appellent `requireAuth()` deviennent publiques en silence**.
~25 routes API affectées (cf `grep -rln "@/lib/supabase/api-auth" src/`).

**À faire d'abord** : retirer ce fallback `return { user: "internal" }`,
le remplacer par un `throw` explicite. C'est un quick win sécu (~10min).

### P1.4 — Plan de migration auth (3-4h)

1. **Créer `src/lib/auth/require-auth.ts`** Auth.js-based (équivalent
   moderne du `requireAuth` Supabase)
2. **Sed-remplacer** dans les ~25 routes API :
   `import { requireAuth } from "@/lib/supabase/api-auth"` →
   `import { requireAuth } from "@/lib/auth/require-auth"`
3. **Renommer** `lib/supabase/tenant.ts` → `lib/tenant.ts` + update imports
4. **Supprimer** `lib/supabase/{server,api-auth,middleware,user-context}.ts`
5. **`npm uninstall @supabase/ssr @supabase/supabase-js`**
6. **Retirer ENV** des secrets staging + prod : `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`,
   `SUPABASE_SMTP_CONFIGURED`
7. **Supprimer scripts** : `scripts/migrate-supabase-to-authjs.ts`,
   `scripts/check-supabase-ratelimit.sh`
8. **Mettre à jour** `package.json` : retirer `test:guard` qui appelle
   le script supprimé
9. Smoke complet e2e Playwright pour vérifier zero régression login

**Risque mitigation** : faire route-par-route, commit par commit. Si une
route casse, rollback isolé.

### P1.5 — Documentations et scripts orphelins

À supprimer ou réécrire :
- `docs/INVITE-FLOW.md` (mentionne Supabase Auth — vérifier)
- `docs/TESTING.md` (instructions Supabase signup)
- `docs/SECURITY-DEBT.md` (peut-être listait déjà tout ça — fusionner avec ce ticket)
- `README.md` (sections Supabase à retirer)
- 6 specs e2e qui font des `import.*supabase` : `e2e/saas-flow.spec.ts`,
  `e2e/invite-flow*.spec.ts`, `e2e/admin-members.spec.ts`,
  `e2e/mobile-viewport.spec.ts`, `e2e/ui-siren-smoke.spec.ts` (déjà dans
  `_deprecated`), `e2e/scenario-invite-teammate.spec.ts`

**Estim totale P1** : 4-6h pour faire ça **proprement** route par route,
pas en sauvage. Pas en 1 commit géant.

---

## P2 — Colonnes legacy prod à dégager (Expand & Contract)

### P2.1 — `prospection_plan` (déjà tickets #17)

Colonne legacy avec backfill `plan` ← `prospection_plan` validé.
Fallback raw SQL `SELECT prospection_plan AS plan FROM tenants` encore
présent dans `src/lib/supabase/tenant.ts:78` et `health/route.ts:90-99`.
**Effet collatéral découvert au smoke staging** : tenant purged montre
encore `plan:"freemium"` via ce fallback alors que `tenants.plan = NULL`.

**Fix** :
1. Vérifier que tous les readers utilisent `tenants.plan` (pas le fallback)
2. Migration 0006 : `ALTER TABLE tenants DROP COLUMN prospection_plan`
3. Migration 0007 (optionnelle) : `DROP COLUMN trial_ends_at` qui est
   aussi legacy Supabase (vérifier d'abord les readers)

### P2.2 — `subscription_id` jamais rempli (0 lignes en prod)

```sql
SELECT count(*) FILTER (WHERE subscription_id IS NOT NULL) AS stripe_subs FROM tenants;
-- → 0
```

Colonne UUID dans `tenants.subscription_id`. Stripe ne l'a jamais utilisée.
La source de vérité Stripe est dans le Hub (cf contrat §7.4). **Drop** ou
documenter pourquoi on la garde. Estim 15min.

### P2.3 — Tables Prisma orphelines en DB prod

**62 tables en prod, 23 dans schema.prisma → 39 tables non-Prisma** :

| Table | Type | Garder ? |
|---|---|---|
| `email_verification`, `phone_verification`, `magic_links`, `mfa_codes`, `verification_tokens` | Auth Supabase legacy | ❓ vérifier que Auth.js utilise les siennes (accounts/sessions) + drop |
| `pj_leads`, `ovh_monthly_destinations`, `results` | Confirmées legacy (commentaire schema.prisma:3) | À **drop** |
| `staging_bodacc`, `staging_ca_trust`, `staging_master_enrich`, `staging_sirene_src` | Pipeline scraping ad-hoc | Garder mais documenter |
| `v_s01_*` à `v_s30_*`, `v_top_*` | Vues matérialisées segments (35 vues) | Garder, partie de la valeur métier |
| `inpi_history`, `segment_catalog`, `notification_preferences` | Tables app non Prisma | Décider : ajouter au schema OU drop |

**Estim** : 1h investigation, puis 2 migrations propres pour dropper le
vraiment mort.

### P2.4 — Colonnes Twenty / Notifuse jamais écrites côté Prospection

Dans `tenants` :
- `twenty_workspace_id`, `twenty_subdomain`, `twenty_api_key`,
  `twenty_user_email`, `twenty_user_password`, `twenty_login_token`,
  `twenty_login_token_created_at` (7 colonnes)
- `notifuse_workspace_slug`, `notifuse_api_key`, `notifuse_user_email`,
  `notifuse_invitation_sent_at` (4 colonnes)

**Constat** :
- Grep `UPDATE/CREATE/INSERT` sur ces colonnes côté Prospection src/ : **0
  références** (sauf nullage au purge)
- 5 tenants prod ont `twenty_workspace_id != NULL`, 11 ont
  `notifuse_api_key != NULL` → données historiques abandonnées

**Décision business à prendre** : ces colonnes ont vocation à servir au
**Hub** (pas Prospection) pour propager les intégrations cross-app. Mais
côté Prospection elles sont **mortes**. Soit on les vire (et le Hub les
gère dans son propre schema), soit on les déplace dans `metadata` JSONB.

**Estim** : 30min après décision business avec Robert.

### P2.5 — Code mort `src/app/api/twenty/*` + `src/lib/twenty.ts`

**Constats** :
- 0 hits dans les logs prod sur 1000 lignes (`grep -c "/api/twenty"`)
- Aucun container `twenty` actif côté prod ou staging
- `src/lib/twenty.ts` = 12 KB de client GraphQL inutilisé
- 2 routes API mortes : `src/app/api/twenty/export/route.ts`,
  `src/app/api/twenty/qualification/route.ts`

**Action** : supprimer.

**Estim** : 15min.

---

## P3 — Hacks documentés explicitement

### P3.1 — `checkTrialExpired` = `return false` (commentaire `Hack temporaire`)

`src/lib/trial.ts:31-33` :

```ts
export async function checkTrialExpired(_userId: string): Promise<boolean> {
  return false;
}
```

Commentaire avoue : "Hack temporaire. Quand on rebranchera : lecture via
`prisma.tenant.findFirst` après ajout des colonnes au schema." Les colonnes
sont **ajoutées maintenant** (P4 livrée 2026-05-19). Donc on peut câbler.

**Comportement attendu** :
- Lire `tenant.plan`
- Si plan est `lifetime_*` ou `internal` → return false (immunité §3.3)
- Sinon vérifier `trial_ends_at < NOW()` (avec dual-read si la colonne n'a
  pas encore migré vers Prisma)

**Estim** : 1h dev + tests, mais **attention impact UX** : si on rebranche
sans précaution, des tenants `freemium` avec `trial_ends_at` passé risquent
de basculer en mode dégradé du jour au lendemain. Faire un dry run audit
DB d'abord.

### P3.2 — TODOs `authjs-migration` épars

```
src/app/api/auth/token/route.ts:1: TODO(authjs-migration) legacy login token via Supabase
src/app/api/webhooks/stripe/route.ts:74: TODO(authjs-migration) prospection_plan legacy
src/app/invite/[token]/invite-accept-form.tsx:58: TODO(authjs-migration)
```

3 TODOs ouvrent la route à la migration Auth.js. À regrouper dans une
seule story dédiée.

### P3.3 — TODOs `pass tenantId` orphelins

```
src/app/api/twenty/qualification/route.ts:10:  TODO: pass tenantId when query supports it
src/app/api/twenty/qualification/route.ts:38:  TODO: pass tenantId when query supports it
src/app/api/phone/telnyx-token/route.ts:17:  TODO: pass tenantId when query supports it
```

Twenty est mort (P2.5), donc 2 TODOs disparaissent à la suppression.
Reste 1 TODO `telnyx-token`. À vérifier si la query supporte tenantId
maintenant (vu que les routes phone l'utilisent ailleurs).

### P3.4 — TODO `inpi-v36` rge_domaines

`src/components/dashboard/lead-sheet/sections.tsx:932` :
> when a rge_domaines JSONB column lands, expand the RGE badge

Ticket de feature, pas dette. À déplacer dans un ticket d'évolution séparé.

---

## P4 — Refactor candidats (gros fichiers > 700 lignes)

| Fichier | Lignes | Suggestion |
|---|---|---|
| `src/components/dashboard/segment-page.tsx` | 1153 | Découper en sous-composants (header, filters, table, footer) |
| `src/components/dashboard/lead-sheet/sections.tsx` | 1061 | Split par sections logiques (déjà nommé "sections" — mais 1 fichier) |
| `src/components/dashboard/_archived/advanced-filters.tsx` | 961 | `_archived` → **supprimer** (pas archive Git, c'est du dead code livré) |
| `src/lib/segments.ts` | 850 | À évaluer (logique métier dense, peut-être justifié) |
| `src/components/dashboard/prospect-page.tsx` | 844 | Découper |
| `src/components/dashboard/lead-sheet.tsx` | 758 | Découper |
| `src/lib/naf.ts` | 756 | Probablement OK (mapping NAF → libellé, stable) |
| `src/components/dashboard/pipeline-board.tsx` | 692 | Découper |
| `src/lib/queries/prospects.ts` | 618 | Découper (queries probablement en train de devenir spaghetti) |
| `src/components/dashboard/_archived/leads-table.tsx` | 601 | `_archived` → **supprimer** |

### P4.0 — Quick wins refactor — supprimer les `_archived/`

`src/components/dashboard/_archived/` et `e2e/_deprecated/` contiennent
3 fichiers (advanced-filters, leads-table, README + 2 e2e specs) qui
sont du code mort. Le nom `_archived/` n'a aucun effet à part faire grossir
le repo. **Git fait office d'archive**. Supprimer.

**Estim** : 5min.

### P4.1 — Refactor `segment-page.tsx` (1153 lignes)

Sans-doute le pire offender. Devrait être :
- `SegmentPageHeader.tsx` (~100 lignes)
- `SegmentFiltersPanel.tsx` (~300 lignes)
- `SegmentResultsTable.tsx` (~400 lignes)
- `SegmentExportActions.tsx` (~150 lignes)
- `SegmentPage.tsx` orchestrateur (~200 lignes)

**Estim** : 2-4h selon la complexité interne. À faire **après** stabilisation
P1-P3, sinon on refactor sur du code qu'on va virer.

---

## P5 — Tests-pending : 126 fichiers en dette

`tests-pending.txt` (126 lignes) = la dette test connue. Husky bloque les
nouvelles routes API sans test depuis 2026-05-13 (NUCLEAR mode), mais les
fichiers déjà en pending traînent.

**Stratégie** :
1. Trier par criticité (routes API > components > hooks > lib)
2. Pour chaque fichier en pending :
   - Écrire son test (l'audit de Robert montre que je dois pas les bâcler)
   - Retirer de `tests-pending.txt`
3. Sprint hebdo "5 fichiers/semaine" → cleanup complet en ~6 mois

Composants avec UI complexe (lead-sheet, pipeline-board) = tests DOM
Playwright plutôt que vitest. Définir le bon outil par fichier.

---

## P6 — ENV vars renommage (cohérence cross-app contrat)

### P6.1 — `TENANT_API_SECRET` → `HUB_API_SECRET`

Contrat §6.5 dit `HUB_API_SECRET` côté app. Aujourd'hui Prospection lit les
deux (fallback en place dans `src/lib/hub/hmac.ts:21`). Migration douce
possible :
1. Ajouter `HUB_API_SECRET` dans secrets staging/prod (même valeur)
2. Confirmer logs prod ne mentionnent plus `TENANT_API_SECRET`
3. Retirer `TENANT_API_SECRET` des secrets
4. Retirer le fallback du code

**Estim** : 30min + 7 jours d'observation passive entre étapes.

### P6.2 — Supprimer ENV legacy provisionnement Supabase

Cf P1.4 étape 6.

### P6.3 — Documenter ENV vars d'env-vars

Créer `docs/ENV-VARS.md` qui liste toutes les ENV vars avec :
- Nom canonique
- Description
- Valeurs typiques staging/prod
- Si secret ou public
- Source de vérité (qui la produit, qui la consomme)

Aujourd'hui éparpillé dans 4+ fichiers/scripts. **Estim** : 1h.

---

## P7 — Auth — 4 patterns d'import différents

Constaté `grep` :

```
from "@/lib/auth"
from "@/lib/auth/api-auth"
from "@/lib/auth/user-context"
from "@/lib/hub/auth"   (← ajouté par moi P1/P2)
```

Plus `@/lib/supabase/api-auth` qui est l'ancien. **5 chemins différents
pour faire de l'auth dans 55 routes API**. Aucun developer ne sait
lequel utiliser.

**Cible** :
- `@/lib/hub/auth` — auth machine-to-machine HMAC Hub (à conserver)
- `@/lib/auth/require-user` — auth user humain via Auth.js session
- `@/lib/auth/require-admin` — auth user admin

3 helpers, un point d'entrée par cas d'usage. **Estim** : 2h refactor +
tests.

---

## P8 — Tests-pending Husky NUCLEAR ne devrait pas tolérer les `_archived`

Aujourd'hui `tests-pending.txt` contient `src/components/dashboard/_archived/advanced-filters.tsx` et `_archived/leads-table.tsx`. Si on supprime ces fichiers (P4.0), le mapping doit retirer aussi. Ajouter au script `check-test-mapping.sh` une règle qui **rejette** les fichiers dans des dossiers `_archived/`, `_deprecated/`, `_legacy/` au lieu de les tolérer en pending.

**Estim** : 15min.

---

## Synthèse — sprints proposés

### Sprint 1 (3-4h, **avant giga-MAJ prod**)
- P0.1 : Apply migrations 0004 + 0005 sur prod
- P0.2 : Refactor `ensureOwnerAdmin` → helper Prisma propre
- P4.0 : Supprimer `_archived/` + `_deprecated/`
- P2.5 : Supprimer code Twenty mort
- P6.1 : Renommer `TENANT_API_SECRET` → `HUB_API_SECRET` (étape 1)

### Sprint 2 (5-6h, post-giga-MAJ)
- P1.3 : Retirer fallback `{ id: "internal" }` (quick win sécu)
- P1.4 : Migration auth Supabase → Auth.js, route par route
- P1.5 : Cleanup docs/scripts Supabase
- `npm uninstall @supabase/*`
- P6.2 : Retirer ENV Supabase

### Sprint 3 (3-4h)
- P3.1 : Re-câbler `checkTrialExpired` proprement
- P2.1 : Migration 0006 drop `prospection_plan`
- P2.2 : Drop ou documenter `subscription_id`
- P2.3 : Tables prod orphelines — investigation + drop sélectif
- P2.4 : Décision Twenty/Notifuse colonnes tenants

### Sprint 4 (2 jours)
- P4.1 + autres refactors fichiers > 700 lignes
- P5 : Sprint cleanup tests-pending (5/semaine en routine)
- P7 : Unifier auth pattern
- P3.2/P3.3 : TODO cleanup
- P8 : Husky NUCLEAR strict `_archived/`

---

## Métriques cible post-cleanup

| Métrique | Aujourd'hui | Cible |
|---|---|---|
| Fichiers `_archived/` ou `_deprecated/` | 5 | 0 |
| TODO/FIXME/HACK dans `src/` | 63 | < 20 (les légitimes documentés) |
| Fichiers Supabase imports | 49 | 0 |
| ENV vars `SUPABASE_*` | 5 | 0 |
| Fichiers > 1000 lignes | 2 | 0 |
| Fichiers > 700 lignes | 7 | < 3 (cas justifiés) |
| Tables prod non Prisma | 39 | < 10 (legacy data sources documentées) |
| Routes API sans test (`tests-pending.txt`) | 126 | 0 |
| Patterns d'import auth | 5 | 3 (hub, user, admin) |

---

## Risques globaux à mitiger pendant le cleanup

1. **Suppression Supabase quand le fallback `{id:"internal"}` saute** → 25
   routes deviennent publiques. **TOUJOURS** retirer le fallback AVANT de
   commencer la migration auth.
2. **Migration 0006 drop `prospection_plan`** = destructive. Vérifier
   N+1 expand & contract (image previous ne doit pas lire la colonne).
3. **Refactor gros fichiers** : tester avec un user staging avant prod,
   les tests vitest unitaires ne couvrent pas tout l'UX.
4. **Renommage ENV** : faire avec fallback de lecture (`HUB_API_SECRET || TENANT_API_SECRET`)
   pendant 30j, comme on a fait pour HMAC P1.

---

## Réponse — (à compléter au fil des sprints)
