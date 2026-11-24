-- Liaisons entre apps Veridian (VER-246) : poignée de délégation remise par le Hub au rebond, gardée chiffrée et liée à
-- la session ; journal des envois, qui rend chaque geste rejouable. Additif : le code encore servi n'en lit rien.
ALTER TABLE "sso_login_tokens" ADD COLUMN IF NOT EXISTS "delegation" TEXT;
CREATE TABLE IF NOT EXISTS "session_delegations" (
  "session_id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "hub_tenant_id" UUID,
  "poignee" TEXT NOT NULL,
  "expire_le" TIMESTAMPTZ NOT NULL,
  "cree_le" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "session_delegations_user_id_idx" ON "session_delegations"("user_id");
CREATE TABLE IF NOT EXISTS "atlas_envois" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL,
  "geste" UUID NOT NULL,
  "etape" TEXT NOT NULL,
  "cible" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "etat" TEXT NOT NULL,
  "tracee" BOOLEAN NOT NULL DEFAULT false,
  "resultat" JSONB,
  "cree_le" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "maj_le" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "atlas_envois_tenant_id_geste_etape_key" ON "atlas_envois"("tenant_id", "geste", "etape");
CREATE INDEX IF NOT EXISTS "atlas_envois_tenant_id_cible_cree_le_idx" ON "atlas_envois"("tenant_id", "cible", "cree_le");
-- L'envoi d'une seule fiche se trace aussi dans le journal des exports, sans segment.
ALTER TABLE "atlas_exports" ALTER COLUMN "segment_id" DROP NOT NULL;
ALTER TABLE "atlas_exports" ALTER COLUMN "segment_version" DROP NOT NULL;
