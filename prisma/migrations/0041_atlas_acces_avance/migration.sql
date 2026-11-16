-- Atlas (16/11) : accès avancé par espace (SQL en lecture sur ODH, clés API), administrateurs Atlas,
-- clés API hachées. Ajouts seulement : colonnes avec défaut, table neuve.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "acces_avance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "atlas_admin" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "atlas_cles_api" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "nom" TEXT NOT NULL,
  "prefixe" TEXT NOT NULL,
  "empreinte" TEXT NOT NULL,
  "cree_le" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "derniere_utilisation" TIMESTAMPTZ,
  "revoquee_le" TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS "atlas_cles_api_empreinte_key" ON "atlas_cles_api"("empreinte");
CREATE INDEX IF NOT EXISTS "atlas_cles_api_tenant_id_idx" ON "atlas_cles_api"("tenant_id");
