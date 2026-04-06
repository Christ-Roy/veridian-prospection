-- Migration INPI v3.6 — ajoute les 12 colonnes INPI à entreprises + table inpi_history
-- Idempotent : rejouable sans effet de bord.
-- Source : tmp/prestaging-v36/migration_pg_entreprises.sql
-- Date : 2026-04-06

BEGIN;

-- ─── Colonnes INPI v3.6 sur entreprises ──────────────────────────────────────
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ca_last                 BIGINT;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ca_last_year            SMALLINT;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ca_trend_3y             TEXT;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS marge_ebe_pct           DOUBLE PRECISION;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS profitability_tag       TEXT;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS deficit_2y              BOOLEAN;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS scaling_rh              BOOLEAN;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS inpi_nb_exercices       SMALLINT;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS bilan_last_year         SMALLINT;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS bilan_confidentiality   TEXT;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ca_growth_pct_3y        INTEGER;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS actif_growth_pct_3y     INTEGER;

-- ─── Indexes INPI v3.6 ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ent_ca_trend    ON entreprises(ca_trend_3y);
CREATE INDEX IF NOT EXISTS idx_ent_profit      ON entreprises(profitability_tag);
CREATE INDEX IF NOT EXISTS idx_ent_deficit     ON entreprises(deficit_2y)  WHERE deficit_2y  = true;
CREATE INDEX IF NOT EXISTS idx_ent_scaling_rh  ON entreprises(scaling_rh)  WHERE scaling_rh  = true;
CREATE INDEX IF NOT EXISTS idx_ent_ca_last     ON entreprises(ca_last DESC) WHERE ca_last IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ent_bilan_year  ON entreprises(bilan_last_year DESC);

-- Index composite "pépite" (segments S52-S55)
CREATE INDEX IF NOT EXISTS idx_ent_inpi_pepite ON entreprises(prospect_score DESC)
  WHERE profitability_tag = 'top'
    AND ca_trend_3y IN ('growth','growth_strong','growth_continuous')
    AND is_registrar = false;

-- ─── Table satellite inpi_history (historique multi-exercices) ───────────────
CREATE TABLE IF NOT EXISTS inpi_history (
    siren                  VARCHAR(9),
    annee                  SMALLINT,
    date_cloture           DATE,
    type_bilan             VARCHAR,
    confidentiality        VARCHAR,
    ca_net                 BIGINT,
    resultat_net           BIGINT,
    ebe                    BIGINT,
    rcai                   BIGINT,
    total_actif            BIGINT,
    capital_social         BIGINT,
    charges_personnel      BIGINT,
    produits_exploitation  BIGINT,
    immobilisations        BIGINT,
    creances               BIGINT,
    PRIMARY KEY (siren, annee)
);
CREATE INDEX IF NOT EXISTS idx_inpi_siren       ON inpi_history(siren);
CREATE INDEX IF NOT EXISTS idx_inpi_siren_year  ON inpi_history(siren, annee DESC);

COMMIT;

-- ANALYZE en dehors de la transaction
ANALYZE entreprises;
ANALYZE inpi_history;
