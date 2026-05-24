-- Mail SMTP v1 — envoi sortant + trace par prospect
-- (ticket 2026-05-23-feature-mail-smtp-imap-prospects.md, cadrage v1 Robert
-- 2026-05-23 : SMTP envoi UNIQUEMENT, pas d'IMAP, templates pré-définis).
--
-- Avant : aucun moyen d'envoyer un mail depuis Prospection à un prospect
-- avec les credentials du commercial (BYO). Le `mailto:` ouvre un client
-- externe sans trace côté DB → impossible de timeliner les échanges dans
-- la fiche 360.
--
-- Après :
--  * tenant_mail_config (1↔1 avec tenants) : credentials SMTP chiffrés
--    AES-256-GCM avec AUTH_SECRET. Source d'envoi par tenant.
--  * lead_emails : trace de chaque mail envoyé (direction "outgoing" en
--    v1, "incoming" prévu en v2 IMAP). Alimente la timeline 360 prospect
--    (rejoint pipeline_transitions + followups + appointments).
--
-- Migration ADDITIVE — CREATE TABLE + indexes uniquement. Aucun DROP,
-- aucun ALTER sur table existante. Réversible : DROP TABLE des deux tables.

-- ─── 1. tenant_mail_config — SMTP creds par tenant ────────────────────────

CREATE TABLE IF NOT EXISTS "tenant_mail_config" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         UUID NOT NULL UNIQUE,

  -- SMTP envoi (chiffré AES-256-GCM via AUTH_SECRET).
  -- Format de "smtp_password_enc" : "<iv_b64>:<tag_b64>:<ciphertext_b64>".
  -- NULL = config pas encore renseignée par le tenant.
  "smtp_host"         VARCHAR(255),
  "smtp_port"         INTEGER,
  "smtp_username"     VARCHAR(320),
  "smtp_password_enc" TEXT,
  "smtp_tls"          BOOLEAN NOT NULL DEFAULT true,
  "smtp_from_email"   VARCHAR(320),
  "smtp_from_name"    VARCHAR(120),

  -- Résultat du dernier "Tester la connexion" (UI /settings/mail).
  -- last_test_status : "ok" | "auth_failed" | "host_unreachable" | "timeout" | "tls_error" | "unknown".
  "last_test_at"      TIMESTAMPTZ,
  "last_test_status"  VARCHAR(32),
  "last_test_error"   TEXT,

  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "tenant_mail_config_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

-- Index principal : lookup par tenant_id (déjà UNIQUE — donne l'index B-tree).
-- Pas d'index supplémentaire en v1 : 1 row par tenant, peu de scans.

-- ─── 2. lead_emails — trace mails sortants par prospect ───────────────────

CREATE TABLE IF NOT EXISTS "lead_emails" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      UUID NOT NULL,
  "workspace_id"   UUID,
  "user_id"        UUID,

  -- Référence prospect : SIREN comme partout (cf pipeline_transitions).
  -- Nullable si mail envoyé hors prospect (rare, mais pas bloqué côté DB).
  "siren"          VARCHAR(9),

  -- Direction. v1 = "outgoing" uniquement. v2 IMAP ajoutera "incoming".
  "direction"      VARCHAR(16) NOT NULL DEFAULT 'outgoing',

  -- Headers normalisés. message_id généré par nodemailer (`<uuid@host>`).
  -- UNIQUE : protège contre les doublons de send (retry naïf).
  "message_id"     VARCHAR(255) NOT NULL UNIQUE,
  "in_reply_to"    VARCHAR(255),
  "references"     TEXT,

  -- Adresses + sujet + body.
  "from_email"     VARCHAR(320) NOT NULL,
  "from_name"      VARCHAR(120),
  "to_emails"      TEXT[] NOT NULL DEFAULT '{}',
  "cc_emails"      TEXT[] NOT NULL DEFAULT '{}',
  "subject"        VARCHAR(500),
  "body_text"      TEXT,
  "body_html"      TEXT,

  -- Template utilisé (slug, ex: "relance-commerciale-v1"). NULL si compose libre.
  "template_slug"  VARCHAR(64),

  -- Statut envoi.
  -- "queued"   = enregistré en DB avant call SMTP
  -- "sent"     = nodemailer a accepté + retourné un messageId
  -- "failed"   = SMTP a rejeté (auth, timeout, refus relay…)
  "sent_status"    VARCHAR(16) NOT NULL DEFAULT 'queued',
  "sent_error"     TEXT,
  "sent_at"        TIMESTAMPTZ,

  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lecture timeline d'un prospect (endpoint /api/leads/[siren]/timeline).
-- Index couvrant (siren, tenant_id, sent_at DESC) : la timeline trie desc.
CREATE INDEX IF NOT EXISTS "lead_emails_siren_tenant_sent_at_idx"
  ON "lead_emails" ("siren", "tenant_id", "sent_at" DESC);

-- Filtrage par tenant (stats "mails envoyés ce mois").
CREATE INDEX IF NOT EXISTS "lead_emails_tenant_sent_at_idx"
  ON "lead_emails" ("tenant_id", "sent_at" DESC);

-- Lookup par status (retry des failed, monitoring).
CREATE INDEX IF NOT EXISTS "lead_emails_tenant_status_idx"
  ON "lead_emails" ("tenant_id", "sent_status");
