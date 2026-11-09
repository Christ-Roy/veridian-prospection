/**
 * Lien entre un tenant local et son tenant Hub (`tenants.hub_tenant_id`), qui permet de retenir le
 * claim tenant_id du jeton MCP (CONTRAT-MCP §2). Partagé par le provisionnement et
 * `POST /api/tenants/link-hub`.
 *
 * Posé une fois : une valeur différente reçue ensuite est refusée et journalisée, jamais écrasée.
 * Un tenant Hub déjà relié à un autre tenant local est refusé (colonne unique). Ne lève jamais.
 */
import { prisma } from "@/lib/prisma";

export type RaisonLien = "relie" | "deja_relie" | "lien_different" | "tenant_hub_deja_pris" | "erreur";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function lierTenantHub(
  tenant: { id: string; hubTenantId?: string | null },
  hubTenantId: string,
): Promise<{ linked: boolean; raison: RaisonLien }> {
  if (tenant.hubTenantId === hubTenantId) return { linked: true, raison: "deja_relie" };
  if (tenant.hubTenantId) {
    console.warn(`[lien-hub] hub_tenant_id divergent pour tenant=${tenant.id} : gardé ${tenant.hubTenantId}, reçu ${hubTenantId}`);
    return { linked: false, raison: "lien_different" };
  }
  try {
    const autre = await prisma.tenant.findFirst({
      where: { hubTenantId, NOT: { id: tenant.id } },
      select: { id: true },
    });
    if (autre) {
      console.warn(`[lien-hub] hub_tenant_id ${hubTenantId} déjà relié à tenant=${autre.id}, refusé pour tenant=${tenant.id}`);
      return { linked: false, raison: "tenant_hub_deja_pris" };
    }
    await prisma.tenant.update({ where: { id: tenant.id }, data: { hubTenantId } });
    return { linked: true, raison: "relie" };
  } catch (err) {
    console.error(`[lien-hub] hub_tenant_id ${hubTenantId} non relié à tenant=${tenant.id} : ${(err as Error).message}`);
    return { linked: false, raison: "erreur" };
  }
}
