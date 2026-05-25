-- W9d : OAuth PKCE OpenRouter — link compte user (sa clé débite SON crédit).
--
-- Pourquoi pas une colonne sur tenant_ai_config :
--   Le compte OpenRouter est PERSONNEL (un user = un crédit), pas tenant.
--   Plusieurs membres d'un même tenant peuvent connecter leur compte
--   individuellement. La résolution adapter prendra la link user si
--   présente, sinon retombe sur tenant_ai_config, sinon sur la clé
--   Veridian globale.
--
-- Format de api_key_enc : "<iv_b64>:<tag_b64>:<ciphertext_b64>" — même
-- pattern que tenant_ai_config.api_key_enc et tenant_mail_config.smtp_password_enc.
-- Réutilise encryptPassword/decryptPassword via AUTH_SECRET.
--
-- openrouter_email : null par défaut (OpenRouter ne retourne pas l'email
-- au PKCE callback ; on peut éventuellement le récupérer en query
-- /api/v1/auth/key plus tard). Stocké pour affichage UI "compte X
-- connecté".
--
-- Migration ADDITIVE : nouvelle table, aucun ALTER de table existante.
-- Réversible via DROP TABLE.

CREATE TABLE IF NOT EXISTS "user_openrouter_link" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"         UUID NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "api_key_enc"     TEXT NOT NULL,
  "openrouter_email" VARCHAR(320),
  "scope"           VARCHAR(64),
  "connected_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_used_at"    TIMESTAMPTZ,
  "deleted_at"      TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup principal : resolveAdapter() interroge par user_id + deleted_at IS NULL.
CREATE INDEX IF NOT EXISTS "user_openrouter_link_active_idx"
  ON "user_openrouter_link" ("user_id")
  WHERE "deleted_at" IS NULL;
