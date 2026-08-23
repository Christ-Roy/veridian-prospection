-- Canonicalize the ecommerce columns that historically came from
-- scripts/2026-07-11-ecom-columns.sql. Fresh databases and staging clones must
-- expose the same schema as the primary database before x402 index 0033.
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_level text;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_platform text;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_has_payment boolean;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_keyword_score smallint;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS ecom_has_product_schema boolean;
