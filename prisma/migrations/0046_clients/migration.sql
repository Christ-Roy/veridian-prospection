-- Clients d'un espace, importés par SIREN ou SIRET (VISION-ATLAS R1) : taux de pénétration et exclusion des cibles.
CREATE TABLE IF NOT EXISTS "atlas_clients" (
    "tenant_id" UUID NOT NULL,
    "siren" TEXT NOT NULL,
    "ajoute_par" TEXT NOT NULL,
    "cree_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "atlas_clients_pkey" PRIMARY KEY ("tenant_id", "siren")
);
