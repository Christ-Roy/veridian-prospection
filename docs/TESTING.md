# Testing Guide — Prospection Dashboard

## Types de tests

### 1. Unit tests (vitest)
```bash
cd dashboard
npx vitest run src/            # all unit tests
npx vitest run src/lib/trial.test.ts  # specific file
npx vitest --watch             # watch mode
```
**Coverage** : rate-limit, lead-quota, trial guard, localStorage hooks.
**CI** : job `unit` — runs tsc + eslint + vitest. Budget < 90s.

### 2. Integration tests (vitest + Postgres)
```bash
# Requires a Postgres instance (CI uses a service container)
DATABASE_URL="postgresql://postgres:testpass@localhost:5432/prospection_test" \
  npx vitest run e2e/integration/
```
**CI** : job `integration` — spins up Postgres, applies Prisma schema, runs tenant isolation tests.

### 3. E2E tests (Playwright)

#### Against dev server (hot reload)
```bash
CI=1 \
  PROSPECTION_URL="http://100.92.215.42:3000" \
  ROBERT_EMAIL="robert.brunon@veridian.site" \
  ROBERT_PASSWORD="Mincraft5*55" \
  npx playwright test e2e/global-full-flow.spec.ts --project=chromium
```

#### Against staging HTTPS
```bash
CI=1 \
  PROSPECTION_URL="https://saas-prospection.staging.veridian.site" \
  SUPABASE_URL="https://saas-api.staging.veridian.site" \
  npx playwright test --project=chromium
```

#### Multi-browser
```bash
npx playwright test --project=chromium --project=firefox --project=webkit
# Or: BROWSER=chromium npx playwright test
```

**30 specs** : saas-flow, regression, existing-accounts, ui-siren-smoke, admin-pages, lead-detail, status-endpoint, search-prospects, pipeline-kanban, auth-flows, empty-states, error-boundaries, global-full-flow, admin-members, onboarding-flow, stripe-checkout, + non-blocking legacy specs.

### 4. API smoke tests
```bash
APP_URL="https://saas-prospection.staging.veridian.site" \
  npx tsx scripts/test-dashboard-api.ts
npx tsx scripts/test-invite-api.ts
```

### 5. Rate-limit guard
```bash
bash scripts/check-supabase-ratelimit.sh
```
Scans hot-path API routes for uncached Supabase admin API calls.
**MUST pass** — prevents repeat of the 2026-04-06 rate limit incident.

## CI Pipeline

```
unit (90s) → build (2min) → integration (1min) → docker-staging (3min)
  → deploy-staging (30s) → e2e-staging (8min)
  → promote-to-main (ff-only merge)
  → docker-prod → deploy-prod → e2e-prod (login-only)
  → rollback-prod (if e2e fails) → telegram notify
```

## Rules

- **E2E blocking specs** = login-only (loginRobert). NEVER signup.
- **E2E non-blocking** = anything that does signup/provision (can 429).
- **E2E prod** = login-only smoke, 1 spec max. NO signup.
- **Rate-limit guard** must pass in CI — blocks any getUserById in hot paths.
