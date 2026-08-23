-- One concurrent index per migration: Prisma must execute this statement
-- outside a transaction, otherwise PostgreSQL rejects it with SQLSTATE 25001.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ent_ecom_level
  ON entreprises (ecom_level)
  WHERE ecom_level IN ('boutique', 'catalogue');
