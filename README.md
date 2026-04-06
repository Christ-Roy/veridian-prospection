# Prospection Dashboard

> Dashboard SaaS B2B de prospection commerciale, branche du monorepo `veridian-platform`.
> Post-SIREN refactor (2026-04-05) : la clé primaire métier est désormais le SIREN, plus un domaine web.

## Stack

- **Next.js 15** (App Router, Server Components)
- **TypeScript strict**
- **Prisma** contre Postgres 15 (schéma entreprises 996K rows + workspaces + outreach + claude_activity)
- **Supabase** pour l'auth (cookie `sb-*-auth-token` format SSR) et la table `tenants`
- **Twenty CRM** en sortie (export via GraphQL)
- **Tailwind + shadcn/ui** (cards, tables, dialogs, toasts sonner)
- **Playwright chromium** pour les tests e2e, **vitest** pour l'intégration

## Structure

```
dashboard/
├── src/
│   ├── app/                # Next.js routes (pages + api/*)
│   │   ├── api/            # Route handlers (auth, prospects, segments, leads, admin, status, errors...)
│   │   ├── admin/          # Admin UI pages (workspaces, members, kpi)
│   │   ├── prospects/      # Page principale
│   │   ├── segments/       # Pages segments dynamiques ([[...slug]])
│   │   ├── pipeline/       # Kanban des leads
│   │   ├── historique/     # Leads visités
│   │   ├── settings/       # Paramètres
│   │   └── login/          # Form signInWithPassword
│   ├── components/         # React components
│   │   ├── dashboard/      # Tables, sheet lead, filtres
│   │   ├── layout/         # Nav, paywall, trial gate
│   │   ├── ui/             # shadcn primitives
│   │   └── client-error-boundary.tsx
│   ├── lib/
│   │   ├── queries/        # Prisma $queryRaw helpers (entreprises-centric post 2026-04-05)
│   │   ├── supabase/       # Auth middleware, user-context, api-auth
│   │   ├── rate-limit.ts   # In-memory sliding window
│   │   ├── twenty.ts       # Twenty CRM export + getQualifications (SIREN→web_domain resolve)
│   │   └── types.ts        # Lead, Stats, etc.
│   └── generated/          # prisma client (gitignored)
├── e2e/                    # Playwright specs
│   ├── ui-siren-smoke.spec.ts
│   ├── lead-detail-interactions.spec.ts
│   ├── admin-pages-smoke.spec.ts
│   ├── status-endpoint.spec.ts
│   ├── search-prospects.spec.ts
│   ├── client-error-boundary.spec.ts
│   ├── segments-filter.spec.ts
│   └── integration/        # vitest integration (DB Prisma réelle)
├── scripts/                # SQL migrations, scripts standalone tsx (test-*.ts)
├── prisma/schema.prisma    # entreprises + workspaces + outreach + followups + claude_activity + ...
└── docs/
    ├── TESTING.md          # Comment lancer chaque type de test
    └── ARCHITECTURE.md     # (à venir) Vue d'ensemble avec diagramme Mermaid
```

## Getting Started (dev local)

### Pré-requis

- Node 20+
- Postgres local (`docker run` ou natif) sur `localhost:5433` avec user `postgres:devpass`, database `prospection`
- `~/credentials/.all-creds.env` avec les clés Supabase staging (présent par défaut sur `mail`)

### Setup

```bash
cd prospection/dashboard
npm install
cp .env.example .env.local   # puis remplir DATABASE_URL + clés Supabase staging
npx prisma generate
npx prisma migrate deploy    # applique les migrations existantes
```

**⚠ Post-refactor SIREN 2026-04-05** : la DB locale n'est probablement pas migrée. Voir [`docs/TESTING.md`](docs/TESTING.md) section "DB locale non migrée" pour la procédure de recréation complète (DROP + CREATE + migrate + scripts SIREN refactor + seed demo).

### Lancer en dev

```bash
npm run dev                  # Next dev server sur :3000
```

### Build production

```bash
npm run build                # prisma generate + next build
npm run start                # next start
```

**Règle Veridian** : ne pas utiliser `npm run dev` pour les tests utilisateur finals. Toujours `npm run build && npm run start`.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next dev server avec HMR |
| `npm run build` | Prisma generate + Next build production |
| `npm run start` | Next production server (requiert build préalable) |
| `npm run lint` | Next lint (ESLint) |
| `npm run test:e2e` | Playwright tous specs (nécessite creds staging en env) |
| `npm run test:e2e:ui` | Playwright mode UI interactif |
| `npm run test:integration` | Vitest integration (requiert DB locale migrée) |
| `npm run test:isolation` | Vitest tenant-isolation uniquement |

## Tests

**Voir [`docs/TESTING.md`](docs/TESTING.md)** pour le guide complet : les 4 types de tests (tsc, vitest, scripts tsx, Playwright), les variables d'environnement nécessaires, le fix de la DB locale post-refactor, la section debug.

TL;DR :

```bash
# Type-check + lint
npx tsc --noEmit && npx eslint src/ --quiet

# Smoke browser contre staging
CI=1 \
PROSPECTION_URL="https://saas-prospection.staging.veridian.site" \
SUPABASE_URL="https://saas-api.staging.veridian.site" \
SUPABASE_ANON_KEY="..." SUPABASE_SERVICE_ROLE_KEY="..." \
TENANT_API_SECRET="staging-prospection-secret-2026" \
npx playwright test e2e/ui-siren-smoke.spec.ts --reporter=list

# Smoke API authentifié (15 routes)
APP_URL="..." SUPABASE_URL="..." NEXT_PUBLIC_SUPABASE_URL="..." \
NEXT_PUBLIC_SUPABASE_ANON_KEY="..." SUPABASE_SERVICE_ROLE_KEY="..." \
npx tsx scripts/test-dashboard-api.ts
```

## API — Principaux endpoints

| Route | Description |
|-------|-------------|
| `GET /api/health` | Health check simple (DB ping) |
| `GET /api/status` | Health check détaillé (counts, Supabase, Twenty, timing) — public |
| `POST /api/errors` | Client error logging (window.onerror via ClientErrorBoundary) |
| `GET /api/prospects` | Liste paginée de leads filtrables (preset, dept, CA, effectifs) |
| `GET /api/leads/:siren` | Fiche détaillée d'une entreprise |
| `GET /api/stats` | Stats globales (total, with_phone, etc.) |
| `GET /api/stats/by-department` | Counts par département (DB : entreprises) |
| `GET /api/sectors` | Tree secteurs/domaines (DB : entreprises) |
| `GET /api/segments` | Liste des segments |
| `GET /api/segments/:slug` | Leads d'un segment (view-based ou manuel) |
| `GET /api/pipeline` | Leads par statut outreach |
| `GET /api/followups` | Rappels à venir |
| `GET /api/claude/stats` | Compteurs d'activités Claude |
| `POST /api/twenty/export` | Export leads vers Twenty CRM |
| `GET /api/admin/workspaces` | Admin : liste workspaces |
| `GET /api/admin/members` | Admin : membres par workspace |
| `GET /api/admin/kpi` | Admin : KPIs outreach par workspace |

## Architecture auth

```
Browser → [/login form] → createBrowserClient(supabase).signInWithPassword()
       → cookie sb-saas-api-auth-token posé sur .prospection.app.veridian.site
       → middleware.ts lit le cookie, hydrate user via getUser()
       → requireAuth() dans les routes API gate
       → getUserContext() résout tenantId + workspaces + isAdmin
```

Le refactor SIREN a laissé `lead.domain` = SIREN (9 chiffres) par compat API, avec `lead.web_domain` ajouté en parallèle pour l'affichage et les liens externes (cf. commit `faea1d8`).

## Déploiement

Automatique via GitHub Actions sur `origin/staging` → dev-server + `origin/main` → OVH prod.
**Voir [`../CLAUDE.md`](../CLAUDE.md)** à la racine du repo pour le flow complet (Dokploy, GHCR, secrets).

## Convention de commit

```
<type>(<scope>): <description courte>

<corps explicatif optionnel>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

Types usuels : `feat`, `fix`, `refactor`, `test`, `docs`, `ci`, `chore`.

## Contact

Projet Veridian — Robert Brunon.

