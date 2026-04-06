-- Migration chirurgicale : ajoute uniquement les structures workspace
-- sans toucher aux colonnes existantes de la DB staging.
-- Cf. roadmap/09-workspaces-multi-user.md — Phase 1
--
-- Idempotent : safe à ré-exécuter.

BEGIN;

-- 1) Table workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS workspaces_tenant_id_idx ON workspaces (tenant_id);

-- 2) Table workspace_members
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user_id_idx ON workspace_members (user_id);

-- 3) Ajout workspace_id sur les 4 tables métier
ALTER TABLE outreach         ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE call_log         ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE followups        ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE claude_activity  ADD COLUMN IF NOT EXISTS workspace_id UUID;

CREATE INDEX IF NOT EXISTS outreach_tenant_id_workspace_id_idx        ON outreach        (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS call_log_tenant_id_workspace_id_idx        ON call_log        (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS followups_tenant_id_workspace_id_idx       ON followups       (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS claude_activity_tenant_id_workspace_id_idx ON claude_activity (tenant_id, workspace_id);

-- 4) Table magic_links pour invitations internes prospection
CREATE TABLE IF NOT EXISTS magic_links (
  token        TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  tenant_id    UUID NOT NULL,
  workspace_id UUID,
  role         TEXT NOT NULL DEFAULT 'member',
  invited_by   UUID,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS magic_links_tenant_id_idx ON magic_links (tenant_id);
CREATE INDEX IF NOT EXISTS magic_links_email_idx     ON magic_links (email);

COMMIT;
