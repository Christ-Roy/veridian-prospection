-- 2026-07-11-ecom-columns.sql — DDL des colonnes e-commerce FINES sur entreprises.
--
-- Contexte : le détecteur ecom_signals v13 (ODH, 2026-07-06) produit des signaux
-- de qualité bien plus fiables que le legacy web_has_ecommerce (buggé/périmé).
-- On ajoute 5 colonnes FINES À CÔTÉ du legacy, on ne le remplace pas.
--
-- ⭐ Filtre de FIABILITÉ = ecom_platform renseigné (248K boutiques HAUTE CONF).
--    ecom_level='catalogue' = signal LÂCHE ("potentiel e-commerce"), à traiter
--    comme piste faible. has_payment SOUS-DÉTECTÉ (9K) → jamais un filtre qualité.
--
-- ⚠️ CE FICHIER SE LANCE HORS TRANSACTION (pas de BEGIN/COMMIT) :
--    CREATE INDEX CONCURRENTLY est interdit dans un bloc transactionnel Postgres.
--    Lancement : psql "$DATABASE_URL" -f scripts/2026-07-11-ecom-columns.sql
--    (ne PAS wrapper dans -c "BEGIN; ...").
--
-- Idempotent : IF NOT EXISTS partout, re-lançable sans effet de bord.

\set ON_ERROR_STOP on

-- 1) Les 5 colonnes FINES ecommerce. ADD COLUMN IF NOT EXISTS = idempotent,
--    additif, non-destructif (aucune valeur existante touchée, NULL par défaut).
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_level             text;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_platform          text;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_has_payment       boolean;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_keyword_score     smallint;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_has_product_schema boolean;

-- 2) Index partiel sur ecom_level — cible UNIQUEMENT les lignes actionnables
--    (boutique/catalogue). Les millions de 'aucun'/NULL restent hors index →
--    index compact et sélectif pour le moteur de recherche IA.
--    CONCURRENTLY : pas de lock d'écriture sur la table (table partagée en prod).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ent_ecom_level
  ON entreprises (ecom_level)
  WHERE ecom_level IN ('boutique', 'catalogue');

-- 3) Index partiel sur ecom_platform — c'est LE filtre de qualité (plateforme
--    identifiée = e-commerce confirmé). Partiel WHERE NOT NULL = compact.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ent_ecom_platform
  ON entreprises (ecom_platform)
  WHERE ecom_platform IS NOT NULL;
