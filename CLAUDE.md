# Veridian Prospection — Dashboard B2B SaaS

> Repo standalone extrait du monorepo `veridian-platform` le 2026-05-13.
> 110 commits historique préservé via `git filter-repo`.

## Ce que c'est

Dashboard de prospection commerciale B2B. 996K entreprises françaises
avec scoring technique, données INPI, pipeline commercial, système multi-tenant.

URL prod : https://prospection.app.veridian.site
URL staging : https://saas-prospection.staging.veridian.site

## Stack

- **Next.js 15** App Router, npm
- **Auth.js v5** (Google + Credentials bcrypt) — migré de Supabase Auth le 2026-05-08 (PR #4 monorepo)
- **Prisma 7** + `@prisma/adapter-pg` sur **veridian-core-db** (Postgres dédié)
- **Stripe** (paywall pro/enterprise)
- **Playwright** (e2e tests)
- **Image Docker** : `ghcr.io/christ-roy/prospection:latest`

## Structure (root-level mono-app)

```
/
├── src/
│   ├── app/              # Pages + API routes
│   │   ├── api/          # 20+ routes (prospects, pipeline, admin, stats, tenants, auth)
│   │   ├── (auth)/       # Login page (Auth.js v5)
│   │   └── (dashboard)/  # Prospects, pipeline, historique, settings, admin
│   ├── components/       # React components (dashboard, layout, ui)
│   ├── lib/
│   │   ├── auth.ts       # Auth.js v5 config (Google + Credentials)
│   │   ├── auth/         # Helpers : get-user, require-user, middleware
│   │   ├── queries/      # DB queries (Prisma)
│   │   ├── supabase/     # ⚠️ DEAD CODE — à supprimer (cf TODO)
│   │   └── trial.ts      # Trial/freemium logic via Prisma local
│   └── hooks/            # Custom React hooks
├── e2e/
│   ├── core/             # 6 specs INTOUCHABLES (bloquent le deploy)
│   ├── extended/         # 23 specs (non-bloquants, 3 browsers parallèles)
│   ├── _deprecated/      # Anti-patterns archivés
│   └── helpers/auth.ts   # Canonical user pattern (modèle à suivre)
├── prisma/
│   └── schema.prisma     # Tables prospection sur veridian-core-db schema prospection_app
├── infra/
│   ├── docker-compose.yml  # Compose Git-clean pour Dokploy GitOps (SHA-pinné)
│   ├── .env.example
│   └── README.md
├── docs/
│   ├── runbooks/dokploy-gitops-pattern.md
│   ├── legacy-monorepo-todo/  # ancien todo/apps/prospection/ (TODO + UI-REVIEW + open-data)
│   ├── ARCHITECTURE.md
│   ├── CI-STRATEGY.md
│   ├── architecture/auth-and-tenants.md
│   └── deployment/
├── Dockerfile           # Multi-stage Next.js 15 standalone (npm/corepack retiré du runner pour CVE)
├── package.json
└── playwright.config.ts
```

## Commandes

```bash
npm ci
npm run build         # Build prod (Next.js standalone)
npm run start         # Lancer le build prod local
npm test              # Vitest unit tests (src/**/*.test.ts)
npx playwright test e2e/core/ --project=chromium       # Core e2e
npx playwright test e2e/extended/ --project=chromium   # Extended e2e
```

## Tests

- **Core** (`e2e/core/`) : 6 specs, ~56s. BLOQUANTS. Voir `docs/CI-STRATEGY.md`.
- **Extended** (`e2e/extended/`) : 23 specs, 83+ tests. NON-BLOQUANTS.
- **Unit** (`src/__tests__/`, `src/**/*.test.ts`) : ~57 tests Vitest.
- **Integration** (`e2e/integration/`) : tenant isolation tests (Prisma + Postgres).

## Multi-tenant

- `tenant_id` sur toutes les tables opérationnelles
- Résolution : JWT Auth.js → `User.id` → `WorkspaceMember.workspaceId` → `Workspace.tenantId` (cache 60s)
- Admin : voit tout. Member : voit son workspace uniquement.

## Architecture

- **Auth** : Auth.js v5 (Google OAuth + Credentials bcrypt) sur veridian-core-db schema `hub_app`
- **DB** : Postgres dédiée prospection sur `code-prospection-saas-db-1` (port interne 5432)
- **Stripe** : paywall via webhook (`/api/webhooks/stripe`) qui update directement `tenants` Prisma
- **Cross-app** : Hub provisionne tenants via HMAC (`/api/tenants/provision`, `/api/tenants/magic-link`)

## API routes critiques

- `/api/health` — public, health check (Postgres + uptime + leadCount)
- `/api/status` — public, status détaillé
- `/api/auth/[...nextauth]` — Auth.js v5 routes (signin, signout, callback)
- `/api/auth/token` — magic-link tenant cross-app (lit `Tenant.prospectionLoginToken`)
- `/api/prospects` — protégé, filtres, pagination, quota freemium
- `/api/pipeline` — pipeline commercial 8 stages
- `/api/admin/*` — CRUD membres, KPI, invitations
- `/api/tenants/provision` — endpoint HMAC pour Hub
- `/api/tenants/magic-link` — rotation magic-link à la demande pour Hub
- `/api/webhooks/stripe` — Stripe webhook (subscriptions)

## Règles

- **Auth.js v5 partout** — Plus de Supabase. Le code dans `src/lib/supabase/*` est dead code (voir TODO cleanup).
- **JAMAIS de signup Supabase en e2e** — login comptes existants uniquement
- **`checkTrialExpired` = return false** (hack temporaire, à recabler)
- **URL publique pour appels cross-app** (cf `~/Bureau/cc-saas/prompts/applicatif/07-inter-app-communication.md`)
- **JAMAIS d'appel Supabase admin API dans un hot path** (legacy, cache obligatoire si jamais re-introduit)

## CI/CD

Pipeline simplifié (post-extraction monorepo) :
1. `unit` : tsc + eslint + vitest unit (sans DB)
2. `audit` : npm audit (high+critical bloquant)
3. `build` : npm run build
4. `integration` : vitest e2e/integration vs Postgres service
5. `docker` : build + push `ghcr.io/christ-roy/prospection:latest`

Le déploiement prod se fait via Dokploy. Aujourd'hui en mode Raw (la stack
`compose-connect-redundant-firewall-l5fmki` pull `:latest` au redeploy manuel).
**Migration GitOps Dokploy → en cours**, cf TODO + docs/runbooks/dokploy-gitops-pattern.md.

## Secrets GitHub Actions

| Secret | Origine | Notes |
|---|---|---|
| `CR_PAT` | PAT user-level | Pour push GHCR (le `GITHUB_TOKEN` n'a pas les droits, package lié au repo legacy `Christ-Roy/prospection`) |
| `DOKPLOY_API_KEY` | ~/credentials | API Dokploy prod |
| `DEPLOY_SSH_KEY` | ~/.ssh/id_rsa_ovh | SSH clé OVH prod |
| `PROD_SUPABASE_ANON_KEY`, `PROD_SUPABASE_SERVICE_ROLE_KEY` | container prod | Legacy (à retirer après cleanup Supabase) |
| `PROD_TENANT_API_SECRET` | container prod | HMAC cross-app Hub→Prospection |
| `STAGING_*` | container staging | Same mais staging |
| `STAGING_ROBERT_PASSWORD` | mdp universel | Pour tests e2e staging |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | ~/credentials | Notifications CI |

## Variables GitHub Actions

| Variable | Valeur | Usage |
|---|---|---|
| `VPS_HOST` | `51.210.7.44` | IP OVH prod |
| `VPS_USER` | `ubuntu` | User OVH |
| `DEV_HOST` | `37.187.199.185` | IP dev server |
| `DEV_USER` | `ubuntu` | User dev |
| `COMPOSE_ID_PROD` | `0mJI-sSt6jcOMr_2QJ1iI` | Stack Dokploy prospection-prod |
| `COMPOSE_ID_STAGING` | `j4wqH-42gbeZini9_Ls2k` | Stack Dokploy prospection-staging |

## TODO de la prochaine session

Voir [`TODO.md`](./TODO.md) à la racine du repo.
