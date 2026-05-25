-- Simplification W7a Mail v2 Hub Gateway — DROP des 3 colonnes
-- workspace.mail_provider / gmail_connected_at / gmail_quota_per_day
-- ajoutées en migration 0025.
--
-- L'abstraction `mail_provider` (none / gmail-via-hub / microsoft-via-hub)
-- ne sert à rien : un seul provider câblé (Gmail OAuth via Hub) + le SMTP
-- BYO existant. La route /api/mail/send détecte désormais dynamiquement si
-- le user a un compte Gmail OAuth lié côté Hub via HMAC — source de vérité
-- = Hub, pas une colonne workspace.
--
-- Réversible :
--   Revoir migration 0025_add_mail_provider/migration.sql pour le DDL inverse.

ALTER TABLE "workspaces"
  DROP CONSTRAINT IF EXISTS "workspaces_mail_provider_check",
  DROP CONSTRAINT IF EXISTS "workspaces_gmail_quota_per_day_check";

DROP INDEX IF EXISTS "workspaces_mail_provider_idx";

ALTER TABLE "workspaces"
  DROP COLUMN IF EXISTS "mail_provider",
  DROP COLUMN IF EXISTS "gmail_connected_at",
  DROP COLUMN IF EXISTS "gmail_quota_per_day";
