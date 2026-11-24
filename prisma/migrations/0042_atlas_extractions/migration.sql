-- Atlas (24/11, VER-242) : extraction paginée d'un segment par le MCP (liste de SIREN figée) et journal des
-- exports, qui sert aussi de compteur au quota quotidien par espace. Tables neuves, rien n'est réécrit.
CREATE TABLE IF NOT EXISTS "atlas_extractions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "segment_id" UUID NOT NULL,
  "segment_version" INTEGER NOT NULL,
  "empreinte" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "client" TEXT,
  "version_odh" TEXT NOT NULL,
  "sirens" TEXT[] NOT NULL,
  "total_segment" INTEGER NOT NULL,
  "cree_le" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expire_le" TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS "atlas_extractions_tenant_id_segment_id_cree_le_idx" ON "atlas_extractions"("tenant_id", "segment_id", "cree_le");
CREATE TABLE IF NOT EXISTS "atlas_exports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL,
  "client" TEXT,
  "canal" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "segment_id" UUID NOT NULL,
  "segment_version" INTEGER NOT NULL,
  "extraction_id" UUID,
  "debut" INTEGER,
  "lignes" INTEGER NOT NULL,
  "cree_le" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "atlas_exports_extraction_id_debut_key" ON "atlas_exports"("extraction_id", "debut");
CREATE INDEX IF NOT EXISTS "atlas_exports_tenant_id_canal_cree_le_idx" ON "atlas_exports"("tenant_id", "canal", "cree_le");
