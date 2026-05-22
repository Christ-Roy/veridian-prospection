# [PROSPECTION] e2e/helpers/auth.ts encore sur Supabase GoTrue — 11 specs skippées en silence

> **Type** : Dette technique — tests E2E inopérants
> **Sévérité** : 🟡 P1 — pas de prod en danger, mais 11 specs E2E ne testent plus rien
> **Owner** : agent Prospection
> **Créé** : 2026-05-22
> **Découvert par** : team ui-polish (hors scope UI/UX — remonté par ui-dev + ui-reviewer)

## Contexte

Pendant le setup de la team UI (hot reload + revue Chrome), les deux agents
ont buté sur le login E2E : impossible de se connecter au hot reload avec le
compte canonique. Cause racine = `e2e/helpers/auth.ts` n'a jamais été migré
d'authentification.

## Problème

`e2e/helpers/auth.ts` (`loginAsE2EUser`, `canSignIn`) parle encore à
**Supabase GoTrue** :
- `auth.ts:60` — `SUPABASE_URL` défaut `https://saas-api.staging.veridian.site`
- `auth.ts:198` — `POST ${supabaseUrl}/auth/v1/token?grant_type=password`
- création user via `POST /auth/v1/admin/users` (service role)

Or l'app est passée à **Auth.js v5 + provider Credentials** qui valide
contre les tables Prisma `users` / `accounts` (bcrypt). Le service Supabase
GoTrue ne tourne plus derrière `saas-api.staging.veridian.site` (le DNS
résout via le wildcard Tailscale, mais aucun GoTrue n'écoute).

### Conséquence sournoise — pas un échec rouge, un skip silencieux

`auth.ts:71` a un garde : si `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
sont absents de l'env → `test.skip(true, ...)`. Donc les **11 specs E2E** qui
importent ce helper ne **plantent pas** — elles se **skippent**. Résultat :
11 specs qui ne testent plus rien, sans aucune alerte rouge en CI.

Specs concernées (import `helpers/auth`) :
- `e2e/search-prospects.spec.ts`, `e2e/admin-pages-v1.spec.ts`,
  `e2e/lead-detail-interactions.spec.ts`, `e2e/invite-flow.spec.ts`,
  `e2e/dashboard-crawler.spec.ts`
- `e2e/extended/` : `appointments-full-flow`, `invite-flow`,
  `age-dirigeant-filter`, `search-prospects`, `admin-pages-v1`,
  `lead-detail-interactions`

## Fix attendu

Réécrire `loginAsE2EUser` / `canSignIn` pour le flow Auth.js v5 actuel :
- Login : pattern CSRF + `POST /api/auth/callback/credentials` (cf memory
  `project_chrome_mcp_login_pattern` — `form_input` ne marche pas sur
  Auth.js, faire fetch CSRF + POST credentials direct).
- Création du compte canonique si absent : insérer `users` + `accounts`
  (credentials, hash bcrypt) + `workspace_members` (admin, scope `all`)
  via Prisma ou un endpoint de seed dédié. Idempotent.
- Supprimer toute référence à `SUPABASE_*` et aux URLs `saas-*.staging`.
- Le helper `e2e/helpers/auth.ts` est désigné « canonical user pattern »
  dans le CLAUDE.md de l'app — il doit redevenir le modèle de référence.

## Note — contournement temporaire team UI

Les agents UI ont créé manuellement un compte E2E dans `postgres-staging`
(user + account bcrypt + workspace_member admin) pour pouvoir bosser. C'est
un contournement, pas le fix — le helper doit être réparé proprement.

## Impact

Pas de prod en danger. Mais la couverture E2E réelle est surévaluée : 11
specs vertes en apparence (skippées) qui ne valident plus search, admin,
invite flow, lead detail, appointments. À réparer avant de se fier au vert
E2E pour une promo.
