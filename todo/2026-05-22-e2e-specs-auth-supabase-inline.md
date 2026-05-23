# [PROSPECTION] Specs E2E avec auth Supabase inline (morte)

> **Type** : Dette technique — tests E2E inopérants (couverture surévaluée)
> **Sévérité** : 🔴 P0 (en réalité) — la couverture E2E annoncée est largement surévaluée. La plupart des specs concernées se `test.skip(true, "SUPABASE_KEYS required")` SILENCIEUSEMENT en CI, donc on croit qu'elles passent mais elles ne testent RIEN.
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Découvert par** : agent e2e-fix (en réparant `e2e/helpers/auth.ts`)
> **Maj 2026-05-23** : agent e2e-specs-supabase a migré les 2 premières
> specs (ui-siren-smoke + browser-flow, commit `ab99c40`). Mais a découvert
> que **17 AUTRES specs** ont le même bug — sous-estimation x10.

## État après passe 2026-05-23

### ✅ Migrées (commit `ab99c40`)

- `e2e/ui-siren-smoke.spec.ts`
- `e2e/browser-flow.spec.ts`

### ❌ Restent à migrer (17 specs identifiées par e2e-specs-supabase 2026-05-23)

```
e2e/admin-members.spec.ts                  e2e/extended/admin-members.spec.ts
e2e/admin-pages-smoke.spec.ts              e2e/extended/admin-pages-smoke.spec.ts
e2e/core/regression.spec.ts                e2e/extended/existing-accounts.spec.ts
e2e/existing-accounts.spec.ts              e2e/extended/invite-flow-demo.spec.ts
e2e/invite-flow-demo.spec.ts               e2e/extended/invite-flow.spec.ts
e2e/invite-flow.spec.ts                    e2e/extended/mobile-viewport.spec.ts
e2e/mobile-viewport.spec.ts                e2e/extended/saas-flow.spec.ts
e2e/regression.spec.ts                     e2e/extended/scenario-invite-teammate.spec.ts
e2e/saas-flow.spec.ts
e2e/scenario-invite-teammate.spec.ts
```

### ⚠️ Question méta — doublons e2e/ ↔ e2e/extended/

La plupart des 17 specs ont un doublon entre `e2e/X.spec.ts` et `e2e/extended/X.spec.ts`. **Avant de migrer, trancher** : `e2e/` est-il obsolète ? `e2e/extended/` est-il la vraie source ? Sinon on migre 2× le même contenu pour rien.

Recommandation agent : **investiguer + supprimer les doublons obsolètes** AVANT de lancer la migration des 17. Risque de tout faire en double sinon.

## Contexte

Le ticket `2026-05-22-e2e-helper-auth-supabase-mort.md` (réparation de
`e2e/helpers/auth.ts`) est traité : le helper a été migré sur Auth.js v5.

En passant, deux autres specs ont été repérées avec **exactement le même
bug** mais qui ne passent PAS par `helpers/auth.ts` — elles ré-implémentent
leur propre auth Supabase GoTrue inline :

- `e2e/ui-siren-smoke.spec.ts` — `SUPABASE_URL` défaut
  `https://saas-api.staging.veridian.site`, `POST /auth/v1/signup`,
  `PUT /auth/v1/admin/users/{id}`. Lève une `Error` si `SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY` absents.
- `e2e/browser-flow.spec.ts` — idem : `POST /auth/v1/signup`,
  `PUT` + `DELETE /auth/v1/admin/users/{id}`.

Le service Supabase GoTrue ne tourne plus derrière `saas-api.staging` — ces
deux specs sont donc inopérantes (échec dur ou skip selon le garde).

## Fix attendu

Migrer ces deux specs sur le helper canonique réparé :

```ts
import { loginAsE2EUser } from "./helpers/auth";
// ...
await loginAsE2EUser(page, request);
```

Supprimer tout le bloc d'auth Supabase inline (signup / admin users /
delete user) + les constantes `SUPABASE_URL` / `ANON_KEY` / `SERVICE_KEY`.

⚠️ `browser-flow.spec.ts` crée et **supprime** un user éphémère par run
(`DELETE /auth/v1/admin/users`). Le compte canonique du helper est
*persistant et partagé* — ne pas le supprimer en fin de test. Adapter la
logique : pas de cleanup, le compte est réutilisé (c'est le but du pattern
canonique, cf en-tête de `helpers/auth.ts`).

## Bonus — URLs par défaut obsolètes

Plusieurs specs ont encore `PROSPECTION_URL` par défaut
`https://saas-prospection.staging.veridian.site` (host mort). Overridable
par env donc non bloquant, mais à corriger en passant vers
`https://prospection.staging.veridian.site` :
`search-prospects`, `status-endpoint`, `settings-page`, `segments-filter`,
`ui-siren-smoke`, `browser-flow` (liste non exhaustive — `grep -rn
"saas-prospection.staging" e2e/`).

## Impact

Pas de prod en danger. Couverture E2E surévaluée tant que ces 2 specs ne
tournent pas. Hors périmètre du ticket helper (qui ciblait strictement
`auth.ts` + ses 11 importeurs).
