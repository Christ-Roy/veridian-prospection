-- Mail v2 — provider d'envoi par workspace (ticket
-- 2026-05-25-mail-send-as-user-via-hub-gateway.md).
--
-- Permet de router l'envoi mail soit vers le SMTP BYO historique (default),
-- soit vers le Hub Mail Gateway qui envoie depuis le Gmail OAuth user du
-- commercial (différenciateur produit vs Apollo/Cognism).
--
-- Décision Robert : `mail_provider` au niveau workspace (pas user, pas
-- tenant) car un workspace peut basculer son flow d'envoi pour tous ses
-- commerciaux d'un coup, et chaque user du workspace utilise son propre
-- compte OAuth Gmail (stocké côté Hub via hubUserId).
--
-- Migration ADDITIVE — 3 colonnes nullable ou avec default. Aucun risque
-- pour les tenants existants : tous restent `mail_provider = 'none'`
-- (comportement v1 = SMTP BYO via TenantMailConfig).
--
-- Réversible :
--   ALTER TABLE "workspaces"
--     DROP COLUMN "mail_provider",
--     DROP COLUMN "gmail_connected_at",
--     DROP COLUMN "gmail_quota_per_day";

ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "mail_provider" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "gmail_connected_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "gmail_quota_per_day" INTEGER NOT NULL DEFAULT 250;

-- Whitelist values. 'none' = SMTP BYO ou pas d'envoi. 'gmail-via-hub' = envoi
-- via POST /api/mail/send-as-user du Hub (Gmail OAuth user). 'microsoft-via-hub'
-- réservé v2 (Microsoft Mail Sender pas livré Hub v1).
ALTER TABLE "workspaces"
  DROP CONSTRAINT IF EXISTS "workspaces_mail_provider_check";
ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_mail_provider_check"
  CHECK ("mail_provider" IN ('none', 'gmail-via-hub', 'microsoft-via-hub'));

-- Quota Gmail standard = 250/jour. Workspace Google = 2000/jour. Override
-- possible (admin manuel) si le user a un compte Workspace, mais default
-- conservateur pour éviter de cramer le quota par erreur.
ALTER TABLE "workspaces"
  DROP CONSTRAINT IF EXISTS "workspaces_gmail_quota_per_day_check";
ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_gmail_quota_per_day_check"
  CHECK ("gmail_quota_per_day" >= 0 AND "gmail_quota_per_day" <= 10000);

-- Index pour les checks rapides "workspaces qui envoient via Hub" (refresh
-- token revoked monitor, batch reconnect alerts, etc.).
CREATE INDEX IF NOT EXISTS "workspaces_mail_provider_idx"
  ON "workspaces" ("mail_provider")
  WHERE "mail_provider" <> 'none';
