-- Ventes d'un espace, rattachées au SIREN du client (VISION-ATLAS R1 : règles de priorité d'après les ventes). Aucune donnée d'acheteur.
CREATE TABLE IF NOT EXISTS "atlas_ventes" (
    "tenant_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "siren" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "date" DATE,
    "ajoute_par" TEXT NOT NULL,
    "cree_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "atlas_ventes_pkey" PRIMARY KEY ("tenant_id", "reference")
);
CREATE INDEX IF NOT EXISTS "atlas_ventes_tenant_id_siren_idx" ON "atlas_ventes"("tenant_id", "siren");
