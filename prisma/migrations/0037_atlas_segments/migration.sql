-- Atlas (09/11) : dossiers, segments et scorings versionnés. Tables neuves, aucune table existante modifiée.
CREATE TABLE IF NOT EXISTS "atlas_dossiers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "parent_id" UUID REFERENCES "atlas_dossiers"("id") ON DELETE SET NULL,
  "nom" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "atlas_dossiers_tenant_id_deleted_at_idx" ON "atlas_dossiers"("tenant_id", "deleted_at");

CREATE TABLE IF NOT EXISTS "atlas_segments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "dossier_id" UUID REFERENCES "atlas_dossiers"("id") ON DELETE SET NULL,
  "parent_id" UUID REFERENCES "atlas_segments"("id") ON DELETE SET NULL,
  "nom" TEXT NOT NULL,
  "colonnes" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "atlas_segments_tenant_id_deleted_at_idx" ON "atlas_segments"("tenant_id", "deleted_at");

CREATE TABLE IF NOT EXISTS "atlas_segment_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "segment_id" UUID NOT NULL REFERENCES "atlas_segments"("id") ON DELETE CASCADE,
  "numero" INTEGER NOT NULL,
  "filtre" JSONB NOT NULL,
  "auteur" TEXT NOT NULL,
  "via" TEXT NOT NULL DEFAULT 'interface',
  "note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "atlas_segment_versions_segment_id_numero_key" ON "atlas_segment_versions"("segment_id", "numero");

CREATE TABLE IF NOT EXISTS "atlas_scoring_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "segment_id" UUID NOT NULL REFERENCES "atlas_segments"("id") ON DELETE CASCADE,
  "numero" INTEGER NOT NULL,
  "criteres" JSONB NOT NULL,
  "auteur" TEXT NOT NULL,
  "via" TEXT NOT NULL DEFAULT 'interface',
  "note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "atlas_scoring_versions_segment_id_numero_key" ON "atlas_scoring_versions"("segment_id", "numero");
