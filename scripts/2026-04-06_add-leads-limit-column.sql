-- =============================================================================
-- 2026-04-06 — Add workspaces.leads_limit column (hotfix prod migration gap)
-- =============================================================================
-- This column exists in staging DB but was missing from 2026-04-04_add-workspaces.sql.
-- Prisma schema references it, so running the full migration sequence without
-- this column crashes /admin/invitations, /admin/kpi, and other admin routes
-- with error: P2022 "column workspaces.leads_limit does not exist".
--
-- Idempotent: safe to re-run.
-- =============================================================================

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS leads_limit INTEGER;
