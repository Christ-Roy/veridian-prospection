-- Identifiant du tenant côté Hub (CONTRAT-MCP §2 : claim tenant_id du jeton MCP).
-- Reçu au provisionnement (hub_tenant_id). Migration ADDITIVE, colonne nullable, renseignée au
-- prochain provisionnement. Réversible via DROP COLUMN.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "hub_tenant_id" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_hub_tenant_id_key" ON "tenants"("hub_tenant_id");
