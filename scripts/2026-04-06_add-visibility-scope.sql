-- 2026-04-06_add-visibility-scope.sql
-- Ajoute workspace_members.visibility_scope pour contrôler ce qu'un membre voit:
--   'all'  : tout le workspace (défaut, comportement actuel)
--   'own'  : uniquement ses propres assignations (outreach.assignee_id ou created_by)
--
-- Idempotent : safe à ré-exécuter.
--
-- Usage (dev) :
--   ssh dev-pub "docker exec -i compose-bypass-bluetooth-feed-tbayqr-prospection-db-1 \
--     psql -U postgres -d prospection" < scripts/2026-04-06_add-visibility-scope.sql

BEGIN;

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS visibility_scope TEXT NOT NULL DEFAULT 'all';

-- Contrainte de valeur : 'all' | 'own' (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_members_visibility_scope_chk'
  ) THEN
    ALTER TABLE workspace_members
      ADD CONSTRAINT workspace_members_visibility_scope_chk
      CHECK (visibility_scope IN ('all', 'own'));
  END IF;
END $$;

COMMIT;
