-- Rapport PDF d'un marché, écrit par une IA ou un humain : le texte seul ; les chiffres se relisent à chaque ouverture.
CREATE TABLE IF NOT EXISTS "atlas_rapports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "titre" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "auteur" TEXT NOT NULL,
    "cree_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "atlas_rapports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "atlas_rapports_tenant_id_idx" ON "atlas_rapports"("tenant_id", "cree_le");
