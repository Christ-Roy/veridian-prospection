-- 2026-04-06_add-user-id-attribution.sql
-- Ajoute user_id (nullable) aux tables métier pour attribuer chaque ligne
-- à l'utilisateur qui l'a créée / modifiée. Nécessaire pour :
--   - la page /admin/members qui affiche pipeline + historique par membre
--   - le scope 'own' dans workspace_members.visibility_scope
--
-- Rétro-compat : les lignes existantes restent avec user_id NULL (=
-- "héritage tenant" — visibles par tous dans le workspace).
--
-- Idempotent.
--
-- Usage (dev) :
--   ssh dev-pub "docker exec -i compose-bypass-bluetooth-feed-tbayqr-prospection-db-1 \
--     psql -U postgres -d prospection" < scripts/2026-04-06_add-user-id-attribution.sql

BEGIN;

ALTER TABLE outreach        ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE call_log        ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE claude_activity ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE INDEX IF NOT EXISTS outreach_tenant_user_idx
  ON outreach (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS call_log_tenant_user_idx
  ON call_log (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS claude_activity_tenant_user_idx
  ON claude_activity (tenant_id, user_id);

COMMIT;
