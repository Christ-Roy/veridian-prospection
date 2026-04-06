#!/bin/bash
# sync-prod-to-staging.sh — Nightly sync of prod DB → staging DB
#
# Purpose: Keep staging data identical to prod so e2e tests run against
# realistic data. Designed to run as a Dokploy Schedule Job.
#
# Usage:
#   ./scripts/sync-prod-to-staging.sh
#
# Prerequisites:
#   - ssh prod-pub and ssh dev-pub configured
#   - Prod container: compose-index-solid-state-card-d7uu39-prospection-saas-db-1
#   - Staging container: compose-bypass-bluetooth-feed-tbayqr-prospection-db-1

set -euo pipefail

PROD_CONTAINER="compose-index-solid-state-card-d7uu39-prospection-saas-db-1"
STAGING_CONTAINER="compose-bypass-bluetooth-feed-tbayqr-prospection-db-1"
TIMESTAMP=$(date +%Y%m%d-%H%M)
DUMP_FILE="/tmp/prospection-prod-nightly-${TIMESTAMP}.pgdump"

echo "[sync] Starting prod → staging sync at $(date)"

# 1. Dump prod DB
echo "[sync] Dumping prod DB..."
ssh prod-pub "docker exec ${PROD_CONTAINER} pg_dump -U postgres -Fc --no-owner --no-acl prospection > ${DUMP_FILE}"
DUMP_SIZE=$(ssh prod-pub "ls -lh ${DUMP_FILE} | awk '{print \$5}'")
echo "[sync] Dump created: ${DUMP_FILE} (${DUMP_SIZE})"

# 2. Transfer to dev server
echo "[sync] Transferring dump to dev server..."
ssh prod-pub "cat ${DUMP_FILE}" | ssh dev-pub "cat > ${DUMP_FILE}"
echo "[sync] Transfer complete"

# 3. Restore into staging DB (drop + recreate)
echo "[sync] Restoring into staging DB..."
ssh dev-pub "
docker exec ${STAGING_CONTAINER} psql -U postgres -c 'DROP DATABASE IF EXISTS prospection_backup;' 2>/dev/null || true
docker exec ${STAGING_CONTAINER} psql -U postgres -c 'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '\''prospection'\'' AND pid != pg_backend_pid();' 2>/dev/null || true
docker exec ${STAGING_CONTAINER} dropdb -U postgres --if-exists prospection 2>/dev/null || true
docker exec ${STAGING_CONTAINER} createdb -U postgres prospection
docker cp ${DUMP_FILE} ${STAGING_CONTAINER}:/tmp/restore.pgdump
docker exec ${STAGING_CONTAINER} pg_restore -U postgres -d prospection --no-owner --no-acl /tmp/restore.pgdump 2>&1 | tail -5
echo 'Restore complete'
"

# 4. Verify
echo "[sync] Verifying..."
COUNT=$(ssh dev-pub "docker exec ${STAGING_CONTAINER} psql -U postgres -d prospection -t -A -c 'SELECT count(*) FROM entreprises'")
echo "[sync] Staging entreprises count: ${COUNT}"

# 5. Cleanup dumps
ssh prod-pub "rm -f ${DUMP_FILE}"
ssh dev-pub "rm -f ${DUMP_FILE}"

echo "[sync] ✅ Prod → staging sync complete at $(date). ${COUNT} entreprises."
