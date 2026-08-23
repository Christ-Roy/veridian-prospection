-- Keep this concurrent build isolated from schema changes and other indexes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ent_ecom_platform
  ON entreprises (ecom_platform)
  WHERE ecom_platform IS NOT NULL;
