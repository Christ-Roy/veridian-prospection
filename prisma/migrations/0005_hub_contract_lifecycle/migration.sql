-- Migration 0005: Hub contract §5.7-5.8 — lifecycle v1.1.
-- Non-destructive : toutes les nouvelles colonnes sont nullable.
-- Expand & Contract OK : l'image previous (sans ces colonnes) peut tourner
-- sur le schéma + ; le code lit avec fallback NULL pendant N+1.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS purge_eligible_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_touched_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;

-- Index pour la query "qui est éligible à la purge ?" (admin Hub lifecycle panel).
-- Sans cet index, scan séquentiel à chaque check cron.
CREATE INDEX IF NOT EXISTS tenants_purge_eligible_at_idx
  ON tenants (purge_eligible_at)
  WHERE purge_eligible_at IS NOT NULL;
