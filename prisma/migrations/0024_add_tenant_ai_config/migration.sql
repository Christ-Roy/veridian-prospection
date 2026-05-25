-- Mail IA v1 — génération de templates mail par LLM, BYO clé API par tenant
-- (ticket 2026-05-25-mail-templates-ia-llm.md). Différenciateur commercial
-- Veridian : "IA qui rédige spécifiquement pour CE prospect en se basant
-- sur son scoring tech + son secteur + son historique".
--
-- Décision Robert : "clés API configurables" → BYO. Chaque tenant fournit
-- SA clé Anthropic / OpenAI / Mistral / OpenRouter. Coût IA porté par le
-- client, pas par Veridian. Cohérent avec le BYO SMTP de la migration 0022.
--
-- Architecture :
--  * 1 config par tenant (UNIQUE tenant_id), admin only côté UI
--  * api_key_enc chiffrée AES-256-GCM via AUTH_SECRET (réutilise
--    src/lib/crypto/encrypt-password.ts — pas de duplication)
--  * Compteur tokens souple (anti-abus + dashboard usage futur)
--
-- Migration ADDITIVE — CREATE TABLE uniquement. Aucun DROP, aucun ALTER
-- sur table existante. Réversible : DROP TABLE "tenant_ai_config".

CREATE TABLE IF NOT EXISTS "tenant_ai_config" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        UUID NOT NULL UNIQUE,

  -- Provider LLM. Whitelist validée côté API Zod :
  --   "anthropic" | "openai" | "mistral" | "openrouter"
  -- VARCHAR(32) volontairement large pour ajout futur (groq, deepseek…).
  "provider"         VARCHAR(32) NOT NULL,

  -- Model identifier passé au provider. Whitelist côté src/lib/ai/models.ts.
  -- Exemples : "claude-opus-4-7" | "gpt-4o" | "mistral-large-latest"
  --          | "openrouter/anthropic/claude-3.5-sonnet"
  "model"            VARCHAR(64) NOT NULL,

  -- Clé API chiffrée AES-256-GCM. Format identique à smtp_password_enc :
  -- "<iv_b64>:<tag_b64>:<ciphertext_b64>". Voir lib/crypto/encrypt-password.ts.
  -- JAMAIS retournée par les routes API au client (masquée en "***").
  "api_key_enc"      TEXT NOT NULL,

  -- Locale par défaut pour la génération. "fr" | "en" (validé côté Zod).
  "default_locale"   VARCHAR(8) NOT NULL DEFAULT 'fr',

  -- Métriques usage — souple, fire-and-forget après chaque generate().
  -- Permettront dashboard "Tu as consommé X tokens ce mois" en v2.
  "last_used_at"     TIMESTAMPTZ,
  "total_tokens_in"  INTEGER NOT NULL DEFAULT 0,
  "total_tokens_out" INTEGER NOT NULL DEFAULT 0,

  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "tenant_ai_config_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

-- Index : lookup par tenant_id déjà couvert par la contrainte UNIQUE
-- (B-tree implicite Postgres). Pas d'index supplémentaire en v1.
