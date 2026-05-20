-- Migration 0009: Ajout api_key_hash + api_key_created_at sur workspaces.
--
-- Contexte : contrat Hub §5.6 + §6.2 — Bearer api_key tenant pour
-- POST /api/workspaces.generateMagicLink. 1 api_key = 1 workspace (scoping
-- strict du contrat). La clé en clair est générée au provision (randomBytes
-- 32 hex = 64 chars), hashée sha256 hex côté Prosp, retournée plain au Hub
-- une seule fois (Hub la stocke dans hub_app.tenants.prospectionApiKey).
--
-- Lookup côté Prosp : sha256(plain_received) == api_key_hash via UNIQUE index.
--
-- Additif uniquement (2 colonnes nullable). Zero downtime.
-- Backfill : aucun. Les workspaces existants n'ont pas d'api_key opérationnelle
-- (le mécanisme est nouveau). Le Hub regénérera à la prochaine action user
-- (re-provision ou rotate ticket §5.15 v1.2).

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS api_key_created_at TIMESTAMPTZ;

-- Index UNIQUE pour le lookup api_key → workspace (auth generateMagicLink).
-- UNIQUE strict : si collision sha256 (impossible en pratique), on refuse
-- la persistance d'une 2e api_key au lieu d'avoir un lookup ambigu.
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_api_key_hash_unique
  ON workspaces(api_key_hash)
  WHERE api_key_hash IS NOT NULL;
