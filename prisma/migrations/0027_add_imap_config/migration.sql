-- Mail v2 — IMAP réception (cron polling, ticket W8b 2026-05-25)
--
-- Avant : tenant_mail_config gère SMTP envoi seulement. Aucun stockage
-- des credentials IMAP, aucune trace de mails entrants → la timeline 360
-- prospect ne voit que les sorties.
--
-- Après : tenant_mail_config étendue avec les colonnes IMAP (host, port,
-- creds chiffrés AES-256-GCM via AUTH_SECRET — même pattern que SMTP), le
-- dossier à scanner ("INBOX" par défaut), le UID le plus récent vu et un
-- petit health log (last_sync_at + last_sync_status + last_sync_error).
--
-- Décision archi (2026-05-25, Robert) : pas de worker container BullMQ
-- comme Twenty CRM. Polling depuis une route Next.js déclenchée par
-- systemd cron toutes les 5 min. 5 min de latence acceptable B2B, zéro
-- infra additionnelle, idempotence garantie par message_id UNIQUE
-- (migration 0022) + ON CONFLICT DO NOTHING dans le cron.
--
-- Migration ADDITIVE — ALTER TABLE ADD COLUMN sur table existante. Aucun
-- DROP, aucun NOT NULL sur rows existantes (tous les ADD sont nullable
-- ou avec DEFAULT). Réversible : DROP COLUMN des 10 colonnes.

ALTER TABLE "tenant_mail_config"
  ADD COLUMN IF NOT EXISTS "imap_host"             VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "imap_port"             INTEGER,
  ADD COLUMN IF NOT EXISTS "imap_username"         VARCHAR(320),
  ADD COLUMN IF NOT EXISTS "imap_password_enc"     TEXT,
  ADD COLUMN IF NOT EXISTS "imap_tls"              BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "imap_folder"           VARCHAR(64) NOT NULL DEFAULT 'INBOX',
  ADD COLUMN IF NOT EXISTS "imap_last_uid_seen"    INTEGER,
  ADD COLUMN IF NOT EXISTS "imap_last_sync_at"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "imap_last_sync_status" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "imap_last_sync_error"  TEXT;

-- Index pour le cron : sélectionne tous les tenants avec imap_host configuré.
-- Partial index (WHERE imap_host IS NOT NULL) : la majorité des tenants
-- n'auront pas d'IMAP configuré au début, on évite de gonfler le B-tree.
CREATE INDEX IF NOT EXISTS "tenant_mail_config_imap_enabled_idx"
  ON "tenant_mail_config" ("tenant_id")
  WHERE "imap_host" IS NOT NULL;
