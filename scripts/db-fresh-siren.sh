#!/usr/bin/env bash
#
# db-fresh-siren.sh — recrée la DB locale prospection from scratch,
# post-SIREN refactor (2026-04-05).
#
# Utilise:
#   - Postgres local sur localhost:5433 (user postgres / pass devpass)
#   - Prisma migrations existantes
#   - Scripts SQL de refactor (2026-04-0*.sql + backfill)
#   - Optionnel: seed-staging-demo.ts si SEED=1
#
# Usage:
#   cd dashboard
#   bash scripts/db-fresh-siren.sh          # recrée sans seed
#   SEED=1 bash scripts/db-fresh-siren.sh   # recrée + seed demo
#
# Idempotent: peut être relancé autant de fois que nécessaire.
# Destructif: DROP DATABASE prospection au début — aucun warning.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Config — override via env si besoin
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5433}"
PG_USER="${PG_USER:-postgres}"
PG_PASS="${PG_PASS:-devpass}"
DB_NAME="${DB_NAME:-prospection}"

export PGPASSWORD="$PG_PASS"

log() {
  echo -e "\033[1;34m[db-fresh-siren]\033[0m $*"
}

die() {
  echo -e "\033[1;31m[db-fresh-siren] ERROR:\033[0m $*" >&2
  exit 1
}

# Check psql available
command -v psql >/dev/null 2>&1 || die "psql not found in PATH"

# Check postgres is reachable
log "Checking Postgres at $PG_HOST:$PG_PORT..."
if ! psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c "SELECT 1" >/dev/null 2>&1; then
  die "Cannot connect to Postgres at $PG_HOST:$PG_PORT as $PG_USER"
fi

# 1. Drop + create DB
log "Dropping database $DB_NAME (if exists)..."
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" >/dev/null

log "Creating fresh database $DB_NAME..."
psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c "CREATE DATABASE $DB_NAME;" >/dev/null

# 2. Apply Prisma migrations baseline
log "Applying Prisma migrations..."
cd "$DASHBOARD_DIR"
export DATABASE_URL="postgresql://$PG_USER:$PG_PASS@$PG_HOST:$PG_PORT/$DB_NAME?schema=public"
npx prisma migrate deploy

# 3. Apply SIREN refactor SQL scripts in order
log "Applying SIREN refactor SQL scripts..."
SQL_FILES=(
  "scripts/2026-04-04_add-entreprises-table.sql"
  "scripts/2026-04-04_add-workspaces.sql"
  "scripts/2026-04-05_add-invitations-table.sql"
  "scripts/2026-04-05_create-segments-views.sql"
  "scripts/2026-04-05_rename-domain-to-siren.sql"
  "scripts/2026-04-06_add-leads-limit-column.sql"
  "scripts/2026-04-06_add-visibility-scope.sql"
  "scripts/2026-04-06_add-user-id-attribution.sql"
  "scripts/2026-04-06_inpi-v36-columns.sql"
  "scripts/2026-04-06_backfill-first-user-admin.sql"
  "scripts/backfill-workspaces.sql"
)

for sql in "${SQL_FILES[@]}"; do
  if [[ -f "$DASHBOARD_DIR/$sql" ]]; then
    log "  → $sql"
    psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" -f "$DASHBOARD_DIR/$sql" -v ON_ERROR_STOP=1 \
      || log "  ⚠ $sql had errors (continuing — may be idempotent or partial)"
  else
    log "  ⚠ $sql not found (skipped)"
  fi
done

# 4. Re-generate Prisma client (schema may have changed after SQL scripts)
log "Re-generating Prisma client..."
npx prisma generate >/dev/null

# 5. Optional seed
if [[ "${SEED:-0}" == "1" ]]; then
  if [[ -f "$DASHBOARD_DIR/scripts/seed-staging-demo.ts" ]]; then
    log "Seeding demo data..."
    npx tsx "$DASHBOARD_DIR/scripts/seed-staging-demo.ts" \
      || log "⚠ seed-staging-demo.ts failed (not critical for schema)"
  else
    log "⚠ seed-staging-demo.ts not found — skipping seed"
  fi
fi

# 6. Quick sanity checks
log "Running sanity checks..."
TABLES=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" -tAc "SELECT string_agg(tablename, ',') FROM pg_tables WHERE schemaname='public' ORDER BY tablename;")
log "  tables: $TABLES"

# Ensure post-refactor columns exist (siren, not domain) in outreach + followups
if psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" -tAc "\\d outreach" 2>/dev/null | grep -q "siren"; then
  log "  ✓ outreach.siren column present (refactor applied)"
else
  log "  ⚠ outreach.siren NOT found — refactor may be incomplete"
fi

if psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" -tAc "\\d followups" 2>/dev/null | grep -q "siren"; then
  log "  ✓ followups.siren column present"
else
  log "  ⚠ followups.siren NOT found"
fi

log "Done. DATABASE_URL=$DATABASE_URL"
log "Next: npm run dev OR npx vitest run e2e/integration/"
