-- Jetons d'autologin du rebond Hub (CONTRAT-HUB §6bis.8.3).
--
-- Pourquoi pas tenants.prospection_login_token : consommer un jeton de tenant
-- connecte son propriétaire, ce qui est faux pour un membre invité, et un
-- rebond écraserait le jeton en cours émis par provision/generateMagicLink.
--
-- Migration ADDITIVE : nouvelle table, aucun ALTER de table existante.
-- Réversible via DROP TABLE.

CREATE TABLE IF NOT EXISTS "sso_login_tokens" (
  "token_hash" TEXT PRIMARY KEY,
  "user_id"    UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "used_at"    TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "sso_login_tokens_user_id_idx" ON "sso_login_tokens"("user_id");
