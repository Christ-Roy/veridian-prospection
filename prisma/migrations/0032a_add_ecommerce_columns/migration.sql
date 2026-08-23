-- Canonicalize the ecommerce columns that historically came from
-- scripts/2026-07-11-ecom-columns.sql. Fresh databases and staging clones must
-- expose the same schema as the primary database before x402 index 0033.
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_level text;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_platform text;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_has_payment boolean;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_keyword_score smallint;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_has_product_schema boolean;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ent_ecom_level
  ON entreprises (ecom_level)
  WHERE ecom_level IN ('boutique', 'catalogue');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ent_ecom_platform
  ON entreprises (ecom_platform)
  WHERE ecom_platform IS NOT NULL;
