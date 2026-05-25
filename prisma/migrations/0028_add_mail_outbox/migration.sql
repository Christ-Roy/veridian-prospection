-- Pattern transactional outbox pour le mail v1 — queue d'envoi asynchrone
-- (ticket 2026-05-25-mail-improvements-followups.md §F).
--
-- Avant : POST /api/mail/send appelle nodemailer en synchrone et bloque
-- la requête HTTP 1-3s (parfois 30s sur cold path SMTP). Un crash réseau
-- transitoire ou un timeout TLS = mail définitivement perdu côté UI alors
-- qu'il pouvait être renvoyé.
--
-- Après : POST /api/mail/send INSERT une row mail_outbox + un placeholder
-- lead_emails(sent_status='queued') dans la MÊME transaction, retourne 202
-- en <100ms. Un worker cron (/api/cron/mail-outbox-flush, toutes les 1 min)
-- consomme les rows queued, exécute le send via lib/mail/smtp.ts existante,
-- met à jour status='sent'|'failed_retry'|'failed' et bump lead_emails.
--
-- Retry exponential : 1min → 5min → 15min → 60min → 24h (5 tentatives).
-- Aligné sur les pratiques mail commerciales (Brevo/Postmark : 5x retries).
-- Au-delà → status='failed' + sent_error final dans lead_emails.
--
-- Migration ADDITIVE — CREATE TABLE + indexes uniquement. Réversible :
-- DROP TABLE mail_outbox.

CREATE TABLE IF NOT EXISTS "mail_outbox" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       UUID NOT NULL,
  "user_id"         UUID,
  "workspace_id"    UUID,
  -- FK soft vers lead_emails — quand le mail est queued on crée déjà la
  -- row lead_emails(sent_status='queued') pour que la timeline 360° le
  -- voie immédiatement. Le worker met à jour la même row au flush.
  "lead_email_id"   UUID,

  -- Payload sérialisé prêt à passer à sendMail() : to / cc / subject /
  -- bodyText / bodyHtml / templateSlug / siren / provider. Tout ce qu'il
  -- faut au worker pour reconstituer l'envoi sans relire le contexte.
  "payload"         JSONB NOT NULL,

  -- Anti-doublon : un caller (workers de campagne futurs, retry UI) peut
  -- fournir son propre idempotency_key. Sinon /api/mail/send génère un
  -- UUID v4. INSERT en conflit → rows ignorées (le mail est déjà en
  -- queue / sent).
  "idempotency_key" UUID NOT NULL,

  -- queued      → enqueued par /api/mail/send, jamais essayé
  -- sending     → locké par le worker via SELECT FOR UPDATE
  -- sent        → SMTP a accepté (info.messageId présent)
  -- failed_retry→ erreur transitoire, en attente du prochain retry
  -- failed      → max attempts atteint, sortie définitive de la file
  "status"          VARCHAR(16) NOT NULL DEFAULT 'queued'
                    CHECK ("status" IN ('queued','sending','sent','failed_retry','failed')),

  "attempts"        INT NOT NULL DEFAULT 0,
  "next_retry_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Trace dernière erreur (reason + smtpCode + message) pour debug UI
  -- côté /history mails. Vidée à chaque succès.
  "last_error"      TEXT,

  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "sent_at"         TIMESTAMPTZ
);

-- Dédup serveur — un caller qui ré-envoie /api/mail/send avec le même
-- idempotency_key tombe sur conflit UNIQUE et l'API retourne 202 + le
-- row id existant (pas un nouveau mail). Pattern Stripe / Notifuse.
CREATE UNIQUE INDEX IF NOT EXISTS "mail_outbox_idempotency_key_idx"
  ON "mail_outbox" ("idempotency_key");

-- Index principal du worker : SELECT FOR UPDATE SKIP LOCKED sur les rows
-- éligibles à un essai (queued OR failed_retry, next_retry_at <= NOW()).
CREATE INDEX IF NOT EXISTS "mail_outbox_status_next_retry_idx"
  ON "mail_outbox" ("status", "next_retry_at")
  WHERE "status" IN ('queued', 'failed_retry');

-- Index audit : "tous les outbox d'un tenant", "tous les failed". Petite
-- table par design (rétention courte : purge des 'sent' > 30 jours via
-- cron futur), pas besoin d'index couvrants.
CREATE INDEX IF NOT EXISTS "mail_outbox_tenant_idx"
  ON "mail_outbox" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "mail_outbox_status_idx"
  ON "mail_outbox" ("status");

-- Index lead_email_id pour le join "trouve l'outbox d'un lead_emails" —
-- utile au worker pour mettre à jour le placeholder queued.
CREATE INDEX IF NOT EXISTS "mail_outbox_lead_email_id_idx"
  ON "mail_outbox" ("lead_email_id")
  WHERE "lead_email_id" IS NOT NULL;
