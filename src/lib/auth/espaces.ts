/**
 * Organisations d'un utilisateur dans Atlas (VER-252). Un espace Atlas = une organisation du Hub (`tenants.hub_tenant_id`).
 * Le Hub dit qui est membre (attach-member, sync-member, remove-member) ; ici on ne fait que choisir où travailler, parmi
 * ceux qu'on a. Le choix vit dans un cookie et se revérifie à chaque requête : le cookie ne donne aucun droit.
 */
import { prisma } from "@/lib/prisma";

export const COOKIE_ESPACE = "veridian-espace";

export type Espace = { id: string; nom: string; role: "owner" | "admin" | "member" | "viewer"; membres: number };

const RANG = { owner: 4, admin: 3, member: 2, viewer: 1 } as const;

export async function espacesDe(userId: string): Promise<Espace[]> {
  const fiches = await prisma.workspaceMember.findMany({
    where: { userId, deletedAt: null, workspace: { deletedAt: null } },
    select: { role: true, workspace: { select: { tenantId: true } } },
  });
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null, OR: [{ userId }, { id: { in: fiches.map((f) => f.workspace.tenantId) } }] },
    select: { id: true, name: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  const membres = await prisma.workspaceMember.findMany({
    where: { deletedAt: null, workspace: { deletedAt: null, tenantId: { in: tenants.map((t) => t.id) } } },
    select: { userId: true, workspace: { select: { tenantId: true } } },
  });
  const par = new Map<string, Set<string>>();
  for (const m of membres) par.set(m.workspace.tenantId, (par.get(m.workspace.tenantId) ?? new Set()).add(m.userId));
  return tenants.map((t) => {
    const roles = fiches.filter((f) => f.workspace.tenantId === t.id).map((f) => (f.role in RANG ? (f.role as Espace["role"]) : "member"));
    const role = t.userId === userId ? "owner" : roles.sort((a, b) => RANG[b] - RANG[a])[0] ?? "member";
    return { id: t.id, nom: t.name, role, membres: new Set([...(par.get(t.id) ?? []), t.userId]).size };
  });
}
