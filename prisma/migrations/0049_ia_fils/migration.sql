-- Fils de l'assistant « Mon IA » (VER-203, CONTRAT-HUB §5.24) : lus et écrits par le Hub seul, supprimés avec l'espace et le membre.
CREATE TABLE IF NOT EXISTS "ia_fils" (
    "session_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "messages" JSONB NOT NULL,
    "cree_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maj_le" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "ia_fils_pkey" PRIMARY KEY ("session_id"),
    CONSTRAINT "ia_fils_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ia_fils_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ia_fils_tenant_id_user_id_idx" ON "ia_fils"("tenant_id", "user_id");
