-- ============================================================================
-- 2026-04-15 — Appointments + NotificationPreferences + Outreach pipeline columns
-- ============================================================================
-- Idempotent. Safe to run on prod (tenants existants).
--
-- 1. Acte les colonnes `pipeline_stage`, `deadline`, etc. qui existent en DB
--    mais pas dans Prisma (raw SQL dans le code actuel).
-- 2. Cree table `appointments` (RDV dedies par tenant, source de verite
--    pour le calendrier et les push notifs).
-- 3. Cree table `notification_preferences` (per-user toggles + delay).
--
-- Commit body: Existing tenants: columns use IF NOT EXISTS, data preserved.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Outreach — pipeline columns (acte l'existant)
-- ----------------------------------------------------------------------------

ALTER TABLE outreach
  ADD COLUMN IF NOT EXISTS pipeline_stage    TEXT,
  ADD COLUMN IF NOT EXISTS deadline          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS interest_pct      SMALLINT,
  ADD COLUMN IF NOT EXISTS site_price        NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS acompte_pct       SMALLINT,
  ADD COLUMN IF NOT EXISTS acompte_amount    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS monthly_recurring NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS annual_deal       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS estimated_value   NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_outreach_pipeline_deadline
  ON outreach (tenant_id, pipeline_stage, deadline)
  WHERE deadline IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Appointments — table dediee RDV
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS appointments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  workspace_id      UUID,
  user_id           UUID,
  siren             TEXT NOT NULL,

  start_at          TIMESTAMPTZ NOT NULL,
  end_at            TIMESTAMPTZ NOT NULL,
  title             TEXT NOT NULL,
  location          TEXT,
  notes             TEXT,

  -- scheduled | done | cancelled | rescheduled
  status            TEXT NOT NULL DEFAULT 'scheduled',

  -- URL Google Calendar prerempli (fallback, pas OAuth)
  google_event_url  TEXT,
  -- Futur: ID Google Calendar event si OAuth un jour
  google_event_id   TEXT,

  -- Marque de notif push envoyee (dedup du cron)
  notified_at       TIMESTAMPTZ,

  -- Lien optionnel avec l'etape pipeline d'origine
  source_stage      TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_start
  ON appointments (tenant_id, start_at);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_user_start
  ON appointments (tenant_id, user_id, start_at);

CREATE INDEX IF NOT EXISTS idx_appointments_siren
  ON appointments (siren);

-- Cron lookup: WHERE status='scheduled' AND start_at BETWEEN ... AND notified_at IS NULL
CREATE INDEX IF NOT EXISTS idx_appointments_pending_reminder
  ON appointments (start_at)
  WHERE status = 'scheduled' AND notified_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3. Notification preferences (per user)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id                 UUID PRIMARY KEY,
  tenant_id               UUID NOT NULL,

  reminder_push           BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_minutes_before SMALLINT NOT NULL DEFAULT 30,
  daily_digest            BOOLEAN NOT NULL DEFAULT FALSE,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_tenant
  ON notification_preferences (tenant_id);
