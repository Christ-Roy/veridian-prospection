-- =============================================================================
-- 2026-04-05 — Invitations table (invite flow for the demo)
-- =============================================================================
-- Idempotent: safe to re-run on dev-db and staging-db.
-- Separate from magic_links (single-use signin tokens) — invitations carry
-- user-creation intent + role assignment and survive until accepted/revoked.
--
-- Apply on dev-db:
--   ssh dev-pub "docker exec -i prospection-dev-db psql -U postgres -d prospection" \
--     < scripts/2026-04-05_add-invitations-table.sql
--
-- Apply on staging-db:
--   ssh dev-pub "docker exec -i compose-bypass-bluetooth-feed-tbayqr-prospection-db-1 \
--     psql -U postgres -d prospection" \
--     < scripts/2026-04-05_add-invitations-table.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS invitations (
  id           SERIAL PRIMARY KEY,
  email        TEXT NOT NULL,
  invited_by   UUID NOT NULL,
  tenant_id    UUID NOT NULL,
  workspace_id UUID,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  token        TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at  TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitations_tenant_id_idx ON invitations (tenant_id);
CREATE INDEX IF NOT EXISTS invitations_token_idx     ON invitations (token);
CREATE INDEX IF NOT EXISTS invitations_email_idx     ON invitations (email);
