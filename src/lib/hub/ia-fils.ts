/**
 * Fils de « Mon IA » (VER-203, CONTRAT-HUB §5.24) : le Hub lit et écrit le fil d'UNE session pour UN membre d'UN espace.
 * Le triplet (session, hub_user_id, tenant_id) se résout ici en ids locaux : l'organisation du Hub par `tenants.hub_tenant_id`,
 * la personne par `users.hub_user_id`, et elle doit être propriétaire ou membre actif de l'espace. Sinon, rien : un fil
 * d'un inconnu, d'un ancien membre ou d'un autre espace n'existe pas (404), on ne dit jamais qu'il existe.
 */
import { prisma } from "@/lib/prisma";

export const FIL_OCTETS_MAX = 1_000_000;
export const FIL_MESSAGES_MAX = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const estUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/** Le membre local derrière (hub_user_id, tenant_id du Hub), ou null s'il n'est pas (ou plus) dans cet espace. */
export async function membreHub(hubTenantId: string, hubUserId: string): Promise<{ tenantId: string; userId: string } | null> {
  if (!estUuid(hubTenantId) || !estUuid(hubUserId)) return null;
  const [tenant, user] = await Promise.all([
    prisma.tenant.findFirst({ where: { hubTenantId, deletedAt: null }, select: { id: true, userId: true } }),
    prisma.user.findFirst({ where: { hubUserId }, select: { id: true } }),
  ]);
  if (!tenant || !user) return null;
  if (tenant.userId === user.id) return { tenantId: tenant.id, userId: user.id };
  const m = await prisma.workspaceMember.findFirst({ where: { userId: user.id, deletedAt: null, workspace: { tenantId: tenant.id } }, select: { userId: true } });
  return m ? { tenantId: tenant.id, userId: user.id } : null;
}

/** Retrait d'un membre ou fin de l'espace : ses fils partent avec lui. */
export async function oublierFils(tenantId: string, userId?: string): Promise<number> {
  return (await prisma.iaFil.deleteMany({ where: { tenantId, ...(userId ? { userId } : {}) } })).count;
}
