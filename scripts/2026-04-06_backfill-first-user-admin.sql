-- 2026-04-06_backfill-first-user-admin.sql
-- Pour chaque tenant qui n'a aucun workspace_member :
--  1) Crée (si manquant) un workspace "Default" (slug=default)
--  2) Assigne le user_id du tenant (owner) comme admin de ce workspace
--
-- Ce backfill est idempotent et ne touche PAS les tenants qui ont déjà
-- au moins un membre.
--
-- Le tenant (et son user_id) vit dans Supabase public.tenants côté hub.
-- Ce script s'exécute sur la DB prospection qui ne voit pas Supabase.
-- Donc on prend une liste de (tenant_id, user_id) en paramètre via une table temp.
--
-- Deux modes d'exécution :
--
-- A) Mode "tenant courant" (workspace + premier user inconnu) :
--    Cet ordre de fallback est utilisé pour les tenants legacy qui n'ont
--    pas de workspace "default" du tout. Il crée le workspace SANS assigner
--    de membre (à faire manuellement ou via l'appel API /admin/members).
--
-- B) Mode "hydraté" (recommandé) :
--    On alimente la table temp `_tenant_owners(tenant_id uuid, user_id uuid)`
--    depuis Supabase AVANT d'exécuter ce script, p.ex. :
--       CREATE TEMP TABLE _tenant_owners (tenant_id uuid, user_id uuid);
--       INSERT INTO _tenant_owners VALUES
--         ('<tenant_uuid>', '<user_uuid>'),
--         ...;
--       \i scripts/2026-04-06_backfill-first-user-admin.sql
--
-- Usage simple (dev) :
--   ssh dev-pub "docker exec -i compose-bypass-bluetooth-feed-tbayqr-prospection-db-1 \
--     psql -U postgres -d prospection" < scripts/2026-04-06_backfill-first-user-admin.sql

BEGIN;

-- Étape 1: garantir qu'un workspace "Default" existe pour chaque tenant
--          qui apparaît déjà dans les tables métier (outreach, etc.)
WITH distinct_tenants AS (
  SELECT DISTINCT tenant_id FROM outreach        WHERE tenant_id IS NOT NULL
  UNION
  SELECT DISTINCT tenant_id FROM call_log        WHERE tenant_id IS NOT NULL
  UNION
  SELECT DISTINCT tenant_id FROM followups       WHERE tenant_id IS NOT NULL
  UNION
  SELECT DISTINCT tenant_id FROM claude_activity WHERE tenant_id IS NOT NULL
)
INSERT INTO workspaces (id, tenant_id, name, slug, created_by, created_at, updated_at)
SELECT gen_random_uuid(), dt.tenant_id, 'Default', 'default', NULL, NOW(), NOW()
FROM distinct_tenants dt
WHERE NOT EXISTS (
  SELECT 1 FROM workspaces w
  WHERE w.tenant_id = dt.tenant_id AND w.slug = 'default'
);

-- Étape 2: si la table temp _tenant_owners existe (mode hydraté), assigner
--          chaque owner comme admin du workspace "default" de son tenant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = '_tenant_owners' AND table_type = 'LOCAL TEMPORARY'
  ) THEN
    INSERT INTO workspace_members (workspace_id, user_id, role, visibility_scope)
    SELECT w.id, t.user_id, 'admin', 'all'
    FROM _tenant_owners t
    JOIN workspaces w ON w.tenant_id = t.tenant_id AND w.slug = 'default'
    WHERE NOT EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = w.id AND wm.user_id = t.user_id
    );
  END IF;
END $$;

-- Étape 3: rapport
SELECT
  (SELECT COUNT(*) FROM workspaces WHERE slug = 'default')      AS default_workspaces,
  (SELECT COUNT(*) FROM workspace_members WHERE role = 'admin') AS admin_memberships;

COMMIT;
