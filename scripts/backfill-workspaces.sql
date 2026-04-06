-- backfill-workspaces.sql
-- Cf. roadmap/09-workspaces-multi-user.md — Phase 1
--
-- Crée un workspace "Default" pour chaque tenant distinct, puis remplit
-- workspace_id sur les rows existantes des 4 tables impactées.
--
-- IDEMPOTENT : peut être exécuté plusieurs fois sans effet de bord.
--
-- Usage (local) :
--   docker exec -i prospection-prospection-db-1 psql -U postgres -d prospection < scripts/backfill-workspaces.sql
--
-- Usage (staging) :
--   psql "$STAGING_DATABASE_URL" < scripts/backfill-workspaces.sql

BEGIN;

-- 1) Récupérer tous les tenant_id distincts présents dans les tables métier
--    (outreach a NOT NULL, les autres peuvent être NULL → on les ignore)
WITH distinct_tenants AS (
  SELECT DISTINCT tenant_id FROM outreach WHERE tenant_id IS NOT NULL
  UNION
  SELECT DISTINCT tenant_id FROM call_log WHERE tenant_id IS NOT NULL
  UNION
  SELECT DISTINCT tenant_id FROM followups WHERE tenant_id IS NOT NULL
  UNION
  SELECT DISTINCT tenant_id FROM claude_activity WHERE tenant_id IS NOT NULL
)
INSERT INTO workspaces (id, tenant_id, name, slug, created_by, created_at, updated_at)
SELECT
  gen_random_uuid(),
  dt.tenant_id,
  'Default',
  'default',
  NULL,
  NOW(),
  NOW()
FROM distinct_tenants dt
WHERE NOT EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.tenant_id = dt.tenant_id AND w.slug = 'default'
);

-- 2) Backfill outreach.workspace_id
UPDATE outreach o
SET workspace_id = w.id
FROM workspaces w
WHERE o.tenant_id = w.tenant_id
  AND w.slug = 'default'
  AND o.workspace_id IS NULL;

-- 3) Backfill call_log.workspace_id
UPDATE call_log c
SET workspace_id = w.id
FROM workspaces w
WHERE c.tenant_id = w.tenant_id
  AND w.slug = 'default'
  AND c.workspace_id IS NULL;

-- 4) Backfill followups.workspace_id
UPDATE followups f
SET workspace_id = w.id
FROM workspaces w
WHERE f.tenant_id = w.tenant_id
  AND w.slug = 'default'
  AND f.workspace_id IS NULL;

-- 5) Backfill claude_activity.workspace_id
UPDATE claude_activity ca
SET workspace_id = w.id
FROM workspaces w
WHERE ca.tenant_id = w.tenant_id
  AND w.slug = 'default'
  AND ca.workspace_id IS NULL;

-- 6) Rapport
SELECT
  (SELECT COUNT(*) FROM workspaces WHERE slug = 'default') AS default_workspaces,
  (SELECT COUNT(*) FROM outreach WHERE workspace_id IS NULL AND tenant_id IS NOT NULL) AS outreach_null_remaining,
  (SELECT COUNT(*) FROM call_log WHERE workspace_id IS NULL AND tenant_id IS NOT NULL) AS call_log_null_remaining,
  (SELECT COUNT(*) FROM followups WHERE workspace_id IS NULL AND tenant_id IS NOT NULL) AS followups_null_remaining,
  (SELECT COUNT(*) FROM claude_activity WHERE workspace_id IS NULL AND tenant_id IS NOT NULL) AS claude_null_remaining;

COMMIT;
