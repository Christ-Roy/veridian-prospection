-- Fast path for the first public x402 canary: department-scoped estimates and
-- company pages. The partial predicate matches DEFAULT_ENTREPRISES_WHERE.
-- Included columns let PostgreSQL answer contact coverage and the four
-- advertised breakdowns from the index when the visibility map permits it.
-- CONCURRENTLY avoids blocking writers while the 996K-row staging clone builds
-- the index; Prisma runs PostgreSQL migrations without an implicit transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ent_x402_dept_cover
ON entreprises (departement)
INCLUDE (
  best_phone_e164,
  best_email_normalized,
  denomination,
  secteur_final,
  ecom_level,
  ecom_platform,
  web_domain_normalized
)
WHERE is_registrar = false
  AND COALESCE(ca_suspect, false) = false;
