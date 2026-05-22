# [PROSPECTION] 2 specs E2E font leur propre auth Supabase inline (morte)

> **Type** : Dette technique — tests E2E inopérants
> **Sévérité** : 🟡 P1 — pas de prod en danger, mais 2 specs E2E ne testent plus rien
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Découvert par** : agent e2e-fix (en réparant `e2e/helpers/auth.ts`)

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
