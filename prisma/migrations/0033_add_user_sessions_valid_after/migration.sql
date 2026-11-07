-- Coupure des sessions d'un compte (CONTRAT-HUB §3.8, revoke_sessions).
-- Les sessions sont des JWT : une session ouverte avant cette date est refusée.
-- Migration ADDITIVE, colonne nullable. Réversible via DROP COLUMN.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessions_valid_after" TIMESTAMPTZ;
