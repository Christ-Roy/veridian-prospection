-- Revert Palier 2 OAuth PKCE OpenRouter user link (W9d, 2026-05-25).
-- La table user_openrouter_link était introduite par la migration 0031.
-- Le revert garde le Palier 1 (fallback ENV OPENROUTER_VERIDIAN_KEY) qui
-- ne dépend d'aucune table — overkill OAuth complet pour coller une clé
-- BYO dans le tenant_ai_config existant.

DROP TABLE IF EXISTS "user_openrouter_link" CASCADE;
