-- Colonne fiche_confiance sur entreprises : niveau de fiabilité du rattachement
-- SIREN↔site, pour la doctrine "garde tout, flague la certitude".
-- Distincte de prospect_tier (bronze/silver/gold = qualité COMMERCIALE).
--
-- Permet d'importer LARGE le réservoir ODH (niveau_0) en prod tout en laissant
-- les commerciaux/le moteur filtrer par niveau de confiance.
--
-- Valeurs canoniques (contrat avec ODH niveau_0.tier) :
--   'fr_dur'        rattachement SIREN sûr (SIRET extrait / match dur)
--   'fr_corrobore'  business FR corroboré, SIREN multi-candidats
--   'gris_geo'      FR probable par signal géo seul (moins sûr)
--   NULL            = les 996K historiques (déjà en prod, rattachement legacy)
--
-- Idempotent : rejouable sans effet de bord.
-- Date : 2026-06-25

BEGIN;

ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS fiche_confiance TEXT;

-- Index partiel : on ne filtre que sur les fiches flaggées (les NULL = legacy,
-- pas besoin d'index dessus). Réduit la taille de l'index.
CREATE INDEX IF NOT EXISTS idx_ent_fiche_confiance
  ON entreprises(fiche_confiance)
  WHERE fiche_confiance IS NOT NULL;

COMMIT;
