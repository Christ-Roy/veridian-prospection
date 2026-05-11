# Prospection — Dashboard B2B SaaS

> Voir le CLAUDE.md racine (`../CLAUDE.md`) pour la vision globale.

## Ce que c'est

Dashboard de prospection commerciale B2B. 996K entreprises francaises
avec scoring technique, donnees INPI, pipeline commercial, system multi-tenant.

## Stack

- Next.js 15 (App Router) + npm
- Prisma + PostgreSQL (multi-tenant, tenant_id sur toutes les tables)
- Supabase Auth (JWT, middleware verification)
- Playwright (e2e tests)

## Structure

```
prospection/
├── src/
│   ├── app/            # Pages + API routes
│   │   ├── api/        # 20+ routes (prospects, pipeline, admin, stats, export)
│   │   ├── (auth)/     # Login page
│   │   └── (dashboard)/ # Prospects, pipeline, historique, settings, admin
│   ├── components/     # React components (dashboard, layout, ui)
│   ├── lib/
│   │   ├── queries/    # DB queries (Prisma)
│   │   ├── supabase/   # Auth, tenant resolution, user context
│   │   └── trial.ts    # Trial/freemium logic (HACKE: return false)
│   └── hooks/          # Custom React hooks
├── e2e/
│   ├── core/           # 6 specs INTOUCHABLES (bloquent le deploy)
│   ├── extended/       # 23 specs (non-bloquants, 3 browsers paralleles)
│   ├── _deprecated/    # Anti-patterns archives
│   └── helpers/auth.ts # Canonical user pattern (modele a suivre)
├── prisma/schema.prisma
├── Dockerfile
└── playwright.config.ts
```

## Commandes

```bash
cd prospection
npm ci
npm run build         # Build prod
npm test              # Vitest unit tests
npx playwright test e2e/core/ --project=chromium   # Core e2e
npx playwright test e2e/extended/ --project=chromium  # Extended e2e
```

## Tests

- **Core** (`e2e/core/`) : 6 specs, 33 tests, ~56s. BLOQUANTS. Voir `.claude/rules/core-tests.md`.
- **Extended** (`e2e/extended/`) : 23 specs, 83+ tests. NON-BLOQUANTS.
- **Unit** (`src/__tests__/`) : 57 tests Vitest.
- **Integration** (`e2e/integration/`) : tenant isolation tests (Prisma + Postgres).

## Multi-tenant

- `tenant_id` sur toutes les tables operationnelles
- Resolution : JWT → user_id → workspace_members → tenant_id (cache 60s)
- Admin : voit tout. Member : voit son workspace.

## API routes critiques

- `/api/health` — public, health check
- `/api/status` — public, status detaille + DB + counts
- `/api/prospects` — protegepar auth, filtres, pagination, quota freemium
- `/api/pipeline` — pipeline commercial
- `/api/admin/*` — CRUD membres, KPI, invitations

## Regles

- JAMAIS d'appel Supabase admin API dans un hot path (cache obligatoire)
- JAMAIS de signup en e2e (login comptes existants uniquement)
- `checkTrialExpired` = return false (hack temporaire, a recabler)
# retrigger 2026-05-11 — deploy CVE bumps (defu, effect, next, postcss) après fix Traefik dual-router



