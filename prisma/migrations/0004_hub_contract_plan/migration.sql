-- Migration 0004: Hub contract §5.2 — plan + planSource + audit history.
-- Non-destructive : toutes les nouvelles colonnes sont nullable / avec default.
-- Backfill de `plan` depuis `prospection_plan` legacy si présent.

-- Tenants : nouvelles colonnes plan + plan_source
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'freemium';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_source TEXT DEFAULT 'stripe';

-- Backfill : la colonne `prospection_plan` existait déjà en Supabase. On la
-- copie dans la nouvelle colonne `plan` pour éviter les divergences. Si elle
-- n'existe pas (dev local fresh), on no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'prospection_plan'
  ) THEN
    EXECUTE 'UPDATE tenants SET plan = COALESCE(prospection_plan, plan) WHERE plan = ''freemium'' OR plan IS NULL';
  END IF;
END $$;

-- Table audit history pour les changements de plan (rétention 50 lignes/tenant
-- gérée côté code ; pas de TTL DB pour pouvoir auditer un historique long).
CREATE TABLE IF NOT EXISTS veridian_plan_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL,
  plan_source   TEXT NOT NULL,
  previous_plan TEXT,
  reason        TEXT,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS veridian_plan_history_tenant_id_changed_at_idx
  ON veridian_plan_history (tenant_id, changed_at DESC);
