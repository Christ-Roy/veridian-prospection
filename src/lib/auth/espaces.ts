/**
 * Organisations d'un utilisateur dans Atlas (VER-252). Un espace Atlas = une organisation du Hub (`tenants.hub_tenant_id`).
 * Le Hub dit qui est membre (attach-member, sync-member, remove-member) ; ici on ne fait que choisir où travailler, parmi
 * ceux qu'on a. Le choix vit dans un cookie et se revérifie à chaque requête : le cookie ne donne aucun droit.
 */
import { prisma } from "@/lib/prisma";

export const COOKIE_ESPACE = "veridian-espace";

/**
 * Un tenant servi : ni supprimé, ni suspendu. Un espace suspendu est fermé comme un espace supprimé (recette du Hub,
 * parente 26/11) : ni listé, ni servi à l'écran ni au MCP ; ses données restent (CONTRAT-HUB §5.4), la reprise rouvre.
 */
export const OUVERT = { deletedAt: null, status: { not: "suspended" as const } };

export const cookieEspace = (id: string) =>
  ({ name: COOKIE_ESPACE, value: id, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 }) as const;

export type Espace = { id: string; nom: string; role: "owner" | "admin" | "member" | "viewer"; membres: number };

const RANG = { owner: 4, admin: 3, member: 2, viewer: 1 } as const;

export async function espacesDe(userId: string): Promise<Espace[]> {
  const fiches = await prisma.workspaceMember.findMany({
    where: { userId, deletedAt: null, workspace: { deletedAt: null } },
    select: { role: true, workspace: { select: { tenantId: true } } },
  });
  const tenants = await prisma.tenant.findMany({
    where: { ...OUVERT, OR: [{ userId }, { id: { in: fiches.map((f) => f.workspace.tenantId) } }] },
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

/**
 * Espace désigné par le `tenant_id` signé du Hub (CONTRAT-MCP §2), sans repli silencieux :
 * relié à aucun tenant local = `tenant_not_linked` ; relié mais l'utilisateur n'en est ni
 * propriétaire ni membre = `tenant_forbidden` ; suspendu = `tenant_suspended` (dit tel quel, jamais un autre espace à la
 * place) ; sinon l'id local du tenant.
 */
export async function espaceHub(
  userId: string,
  hubTenantId: string,
): Promise<{ id: string } | "tenant_not_linked" | "tenant_forbidden" | "tenant_suspended"> {
  const t = await prisma.tenant.findFirst({
    where: { hubTenantId, deletedAt: null },
    select: { id: true, userId: true, status: true },
  });
  if (!t) return "tenant_not_linked";
  if (t.status === "suspended") return "tenant_suspended";
  if (t.userId === userId) return { id: t.id };
  const m = await prisma.workspaceMember.findFirst({
    where: { userId, deletedAt: null, workspace: { tenantId: t.id, deletedAt: null } },
    select: { userId: true },
  });
  return m ? { id: t.id } : "tenant_forbidden";
}
