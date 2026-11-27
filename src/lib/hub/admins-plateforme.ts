/**
 * Administrateur de plateforme dans l'espace d'un client (CONTRAT-HUB §5.23, VER-263). Le Hub désigne ; Prospection pose le
 * rôle `admin` (tous les droits d'un propriétaire sauf supprimer l'espace et transférer la propriété), jamais `owner`.
 *
 * Rien n'est créé : la personne doit déjà être membre de l'espace. Une désignation (`admins_plateforme`) dont la personne ne
 * tient plus le rôle admin, par quelque chemin que ce soit (le client l'a rétrogradée, un `revoke`), EST un retrait : aucun
 * chemin de synchronisation ne la remet admin (`adminRetire`), seul `reinstate: true` (geste humain, jamais envoyé par le Hub).
 *
 * `workspace_id` : l'identifiant du tenant au Hub (`tenants.hub_tenant_id`), l'UUID local, ou l'adresse du propriétaire (ancien contrat).
 */
import type { Prisma } from "@prisma/client";

import { invalidateAllUserContexts } from "@/lib/auth/cache-contexte";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient | typeof prisma;
export type MembreAdmin = { hub_user_id: string; role: string; admin_granted: boolean; admin_withdrawn: boolean };
export type Demande = { workspace_id: string; hub_user_id: string; action: "grant" | "revoke"; actor_hub_user_id: string; reason?: string | null; reinstate?: boolean };

export class RefusAdmin extends Error {
  constructor(public readonly code: "tenant_not_found" | "user_not_in_app" | "not_a_member" | "admin_withdrawn" | "is_owner", public readonly status: 404 | 409) {
    super(code);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANG: Record<string, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

async function espace(workspaceId: string, tx: Tx = prisma): Promise<{ id: string; userId: string } | null> {
  const sel = { id: true, userId: true } as const;
  if (UUID.test(workspaceId)) {
    return (
      (await tx.tenant.findFirst({ where: { hubTenantId: workspaceId.toLowerCase(), deletedAt: null }, select: sel })) ??
      (await tx.tenant.findFirst({ where: { id: workspaceId.toLowerCase(), deletedAt: null }, select: sel }))
    );
  }
  if (!workspaceId.includes("@")) return null;
  const u = await tx.user.findUnique({ where: { email: workspaceId.toLowerCase() }, select: { id: true } });
  return u ? tx.tenant.findFirst({ where: { userId: u.id, deletedAt: null }, orderBy: { createdAt: "asc" }, select: sel }) : null;
}

/** Fiches de membre actives d'un utilisateur dans l'espace (tous ses workspaces vivants). */
const fiches = (tx: Tx, tenantId: string, userId: string) =>
  tx.workspaceMember.findMany({ where: { userId, deletedAt: null, workspace: { tenantId, deletedAt: null } }, select: { workspaceId: true, role: true } });

/**
 * Vrai si cette personne a été désignée administrateur de plateforme et ne tient plus le rôle admin : le client l'a retirée.
 * Tout chemin qui poserait `admin` (sync-member, attach-member, organisation, ouverture d'espace) doit alors refuser.
 */
export async function adminRetire(tenantId: string, userId: string, tx: Tx = prisma): Promise<boolean> {
  const d = await tx.adminPlateforme.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: { userId: true } });
  if (!d) return false;
  return !(await fiches(tx, tenantId, userId)).some((f) => f.role === "admin");
}

export async function listerAdmins(workspaceId: string): Promise<MembreAdmin[]> {
  const t = await espace(workspaceId);
  if (!t) throw new RefusAdmin("tenant_not_found", 404);
  const [lignes, designes, proprietaire] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { deletedAt: null, workspace: { tenantId: t.id, deletedAt: null } }, select: { role: true, userId: true } }),
    prisma.adminPlateforme.findMany({ where: { tenantId: t.id }, select: { userId: true } }),
    prisma.user.findUnique({ where: { id: t.userId }, select: { id: true } }),
  ]);
  const role = new Map<string, string>();
  for (const l of lignes) if ((RANG[l.role] ?? 0) > (RANG[role.get(l.userId) ?? ""] ?? 0)) role.set(l.userId, l.role);
  if (proprietaire) role.set(proprietaire.id, "owner");
  const designe = new Set(designes.map((d) => d.userId));
  const comptes = await prisma.user.findMany({ where: { id: { in: [...new Set([...role.keys(), ...designe])] }, hubUserId: { not: null } }, select: { id: true, hubUserId: true } });
  return comptes.map((u) => {
    const r = role.get(u.id) ?? "none";
    return { hub_user_id: u.hubUserId!, role: r, admin_granted: designe.has(u.id), admin_withdrawn: designe.has(u.id) && r !== "admin" && r !== "owner" };
  });
}

export async function designerAdmin(d: Demande): Promise<MembreAdmin> {
  const r = await prisma.$transaction(async (tx) => {
    const t = await espace(d.workspace_id, tx);
    if (!t) throw new RefusAdmin("tenant_not_found", 404);
    const u = await tx.user.findFirst({ where: { hubUserId: d.hub_user_id.toLowerCase(), deletedAt: null }, select: { id: true, hubUserId: true } });
    if (!u) throw new RefusAdmin("user_not_in_app", 404);
    const f = await fiches(tx, t.id, u.id);
    if (t.userId === u.id || f.some((x) => x.role === "owner")) throw new RefusAdmin("is_owner", 409);
    if (!f.length) throw new RefusAdmin("not_a_member", 404);
    const cle = { tenantId_userId: { tenantId: t.id, userId: u.id } };
    if (d.action === "revoke") {
      await tx.workspaceMember.updateMany({ where: { userId: u.id, deletedAt: null, role: "admin", workspace: { tenantId: t.id } }, data: { role: "member" } });
      const designe = !!(await tx.adminPlateforme.findUnique({ where: cle, select: { userId: true } }));
      return { t, u, membre: { hub_user_id: u.hubUserId!, role: f.some((x) => x.role === "admin") ? "member" : (f[0]?.role ?? "member"), admin_granted: designe, admin_withdrawn: designe } };
    }
    if (!d.reinstate && (await adminRetire(t.id, u.id, tx))) throw new RefusAdmin("admin_withdrawn", 409);
    await tx.workspaceMember.updateMany({ where: { userId: u.id, deletedAt: null, workspace: { tenantId: t.id } }, data: { role: "admin", visibilityScope: "all" } });
    await tx.adminPlateforme.upsert({ where: cle, update: { acteur: d.actor_hub_user_id, raison: d.reason ?? null }, create: { tenantId: t.id, userId: u.id, acteur: d.actor_hub_user_id, raison: d.reason ?? null } });
    return { t, u, membre: { hub_user_id: u.hubUserId!, role: "admin", admin_granted: true, admin_withdrawn: false } };
  });
  invalidateAllUserContexts();
  console.info(`[hub][admins-plateforme] action=${d.action}${d.reinstate ? " reinstate" : ""} tenant=${r.t.id} hub_user=${r.u.hubUserId} acteur=${d.actor_hub_user_id.slice(0, 60)} role=${r.membre.role}`);
  return r.membre;
}
