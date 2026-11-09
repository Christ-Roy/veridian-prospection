-- Atlas (09/11) : dossier de travail, entreprises épinglées par espace. Table neuve.
CREATE TABLE IF NOT EXISTS "atlas_epingles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "siren" TEXT NOT NULL,
  "nom" TEXT NOT NULL,
  "note" TEXT,
  "auteur" TEXT NOT NULL,
  "via" TEXT NOT NULL DEFAULT 'interface',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "atlas_epingles_tenant_id_siren_key" ON "atlas_epingles"("tenant_id", "siren");
