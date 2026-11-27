-- Administrateurs de plateforme désignés par le Hub (CONTRAT-HUB §5.23, VER-263). Additive : aucune colonne existante touchée.
CREATE TABLE IF NOT EXISTS "admins_plateforme" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "acteur" TEXT NOT NULL,
    "raison" TEXT,
    "accorde_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admins_plateforme_pkey" PRIMARY KEY ("tenant_id", "user_id"),
    CONSTRAINT "admins_plateforme_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "admins_plateforme_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
