-- ============================================================================
-- Migration: create `entreprises` master table (SIREN-centric)
-- Date: 2026-04-04
-- Spec: veridian-platform/MASTER_DB_SPEC.md
-- Context: Phase 3 SIREN refactor. Lives alongside existing `results` table.
--          Does NOT touch or modify `results`.
-- Idempotent: safe to run multiple times.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS entreprises (
  -- Bloc 1 — Identité SIRENE
  siren                        VARCHAR(9)  PRIMARY KEY,
  siret_siege                  VARCHAR(14),
  denomination                 TEXT,
  sigle                        TEXT,
  categorie_juridique          VARCHAR(10),
  forme_juridique_libelle      TEXT,
  activite_principale          VARCHAR(10),
  naf_libelle                  TEXT,
  tranche_effectifs            VARCHAR(5),
  categorie_entreprise         VARCHAR(10),
  date_creation                DATE,
  caractere_employeur          VARCHAR(1),
  economie_sociale_solidaire   VARCHAR(1),

  -- Bloc 2 — Adresse siège
  adresse_numero      TEXT,
  adresse_type_voie   TEXT,
  adresse_voie        TEXT,
  adresse_complement  TEXT,
  code_postal         VARCHAR(5),
  commune             TEXT,
  code_commune        VARCHAR(5),
  departement         VARCHAR(3),
  region              TEXT,

  -- Bloc 3 — Contact triangulé
  best_email        TEXT,
  best_phone        TEXT,
  best_phone_type   VARCHAR(10),
  email_sources     JSONB,
  phone_sources     JSONB,
  social_linkedin   TEXT,
  social_facebook   TEXT,
  social_instagram  TEXT,

  -- Bloc 4 — Web
  web_domain               TEXT,
  web_url                  TEXT,
  web_cms                  TEXT,
  web_platform             TEXT,
  web_tech_score           SMALLINT,
  web_obsolescence_score   SMALLINT,
  web_has_https            BOOLEAN,
  web_has_responsive       BOOLEAN,
  web_has_ecommerce        BOOLEAN,
  web_has_devis            BOOLEAN,
  web_has_blog             BOOLEAN,
  web_has_contact_form     BOOLEAN,
  web_has_mentions_legales BOOLEAN,
  web_has_booking          BOOLEAN,
  web_has_chat             BOOLEAN,
  web_copyright_year       SMALLINT,

  -- Bloc 5 — Dirigeant
  dirigeant_nom     TEXT,
  dirigeant_prenom  TEXT,
  dirigeant_qualite TEXT,
  dirigeants_json   JSONB,

  -- Bloc 6 — Finances
  chiffre_affaires    BIGINT,
  resultat_net        BIGINT,
  ebe                 BIGINT,
  marge_ebe           DOUBLE PRECISION,
  taux_endettement    DOUBLE PRECISION,
  bilan_date          DATE,
  bilan_type          VARCHAR(10),
  bilan_confidentiel  BOOLEAN,

  -- Bloc 7 — Certifications
  est_rge               BOOLEAN,
  rge_domaines          JSONB,
  est_qualiopi          BOOLEAN,
  qualiopi_specialites  JSONB,
  est_bio               BOOLEAN,
  est_epv               BOOLEAN,
  est_ess               BOOLEAN,

  -- Bloc 8 — Signaux business
  nb_marches_publics       INTEGER,
  montant_marches_publics  BIGINT,
  dernier_marche_date      DATE,
  nb_permis_construire     INTEGER,
  est_sur_lbc              BOOLEAN,
  est_bni                  BOOLEAN,
  alim_confiance_note      TEXT,
  gmaps_rating             DOUBLE PRECISION,
  gmaps_nb_avis            INTEGER,
  pj_note                  DOUBLE PRECISION,
  pj_nb_avis               INTEGER,

  -- Bloc 9 — Géolocalisation
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  geo_source  VARCHAR(20),

  -- Bloc 10 — Métadonnées & scoring
  has_website        BOOLEAN,
  has_email          BOOLEAN,
  has_phone          BOOLEAN,
  source_count       SMALLINT,
  data_completeness  SMALLINT,
  prospect_tier      VARCHAR(10),
  is_prospectable    BOOLEAN,
  exclusion_raison   TEXT,
  master_updated_at  TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS entreprises_web_domain_idx          ON entreprises (web_domain);
CREATE INDEX IF NOT EXISTS entreprises_code_postal_idx         ON entreprises (code_postal);
CREATE INDEX IF NOT EXISTS entreprises_departement_idx         ON entreprises (departement);
CREATE INDEX IF NOT EXISTS entreprises_activite_principale_idx ON entreprises (activite_principale);
CREATE INDEX IF NOT EXISTS entreprises_prospect_tier_idx       ON entreprises (prospect_tier);
CREATE INDEX IF NOT EXISTS entreprises_est_rge_idx             ON entreprises (est_rge);
CREATE INDEX IF NOT EXISTS entreprises_est_qualiopi_idx        ON entreprises (est_qualiopi);
CREATE INDEX IF NOT EXISTS entreprises_est_bio_idx             ON entreprises (est_bio);
CREATE INDEX IF NOT EXISTS entreprises_chiffre_affaires_idx    ON entreprises (chiffre_affaires);

COMMIT;
