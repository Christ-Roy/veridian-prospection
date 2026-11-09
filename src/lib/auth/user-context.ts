/**
 * Résolution du UserContext (user + tenant + workspaces + role) via
 * Auth.js v5 (session JWT) et Prisma. Cache mémoire 30s par userId.
 */
import { auth } from "@/lib/auth-config";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export type WorkspaceMembership = {
  id: string;
  name: string;
  slug: string;
  role: "admin" | "member" | "owner" | "viewer";
  visibilityScope: "all" | "own";
};

export type UserContext = {
  userId: string;
  email: string;
  tenantId: string;
  tenantOwnerId: string | null;
  workspaces: WorkspaceMembership[];
  isAdmin: boolean;
  activeWorkspaceId: string | null;
};

export type AuthFailure = { error: NextResponse };

const contextCache = new Map<string, { ctx: UserContext; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

async function getAuthUser(): Promise<{ id: string; email: string } | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;
  return { id: session.user.id, email: session.user.email };
}

export async function getUserContext(): Promise<UserContext | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const cookieStore = await cookies();
  return buildUserContext(user, cookieStore.get("active_workspace_id")?.value || null);
}

/**
 * Contexte d'un utilisateur déjà identifié (session ou jeton du Hub pour le MCP), sans lire de
 * cookie : l'espace actif est passé en argument. Même résolution tenant + workspaces + rôle que
 * les écrans, pour qu'une IA n'ait jamais plus de droits que l'utilisateur dans l'interface.
 */
export async function buildUserContext(
  user: { id: string; email: string },
  activeCookie: string | null,
  /** Espace demandé (MCP : `tenant_id` signé par le Hub). Retenu seulement si l'utilisateur en est propriétaire ou membre. */
  preferredTenantId: string | null = null,
): Promise<UserContext | null> {
  const cached = contextCache.get(user.id);
  if (cached && cached.expiresAt > Date.now() && !preferredTenantId) {
    return { ...cached.ctx, activeWorkspaceId: activeCookie };
  }

  // 1) Tenant (local Prisma) — espace demandé s'il est le sien, puis direct ownership, puis membership
  let tenant: { id: string; userId: string } | null = preferredTenantId
    ? await tenantOfUser(user.id, preferredTenantId)
    : null;

  const directTenant = tenant ?? await prisma.tenant.findFirst({
    where: { userId: user.id, deletedAt: null },
    select: { id: true, userId: true },
  });

  if (directTenant) {
    tenant = directTenant;
  } else {
    // Fallback : membre invité — résout le tenant via workspace_members
    // Un membre retiré (deleted_at) n'a plus aucun accès à l'espace.
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id, deletedAt: null, workspace: { deletedAt: null } },
      include: { workspace: true },
    });
    if (membership?.workspace?.tenantId) {
      const memberTenant = await prisma.tenant.findUnique({
        where: { id: membership.workspace.tenantId },
        select: { id: true, userId: true, deletedAt: true },
      });
      if (memberTenant && !memberTenant.deletedAt) tenant = memberTenant;
    }
  }

  if (!tenant) {
    console.warn(`[user-context] No tenant for user ${user.id}`);
    return null;
  }

  // 2) Workspaces (Prisma local, filtré au tenant)
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id, deletedAt: null, workspace: { deletedAt: null } },
    include: { workspace: true },
  });

  const workspaces: WorkspaceMembership[] = memberships
    .filter((m) => m.workspace.tenantId === tenant!.id)
    .map((m) => ({
      id: m.workspaceId,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: (m.role as WorkspaceMembership["role"]) ?? "member",
      visibilityScope:
        (m.visibilityScope as "all" | "own") ?? "all",
    }));

  // 3) Admin status
  const isOwner = tenant.userId === user.id;
  const hasAdminMembership = workspaces.some(
    (w) => w.role === "admin" || w.role === "owner",
  );
  const isAdmin = isOwner || hasAdminMembership;

  // 4) Active workspace
  const activeWorkspaceId =
    activeCookie && workspaces.some((w) => w.id === activeCookie)
      ? activeCookie
      : workspaces[0]?.id ?? null;

  const ctx: UserContext = {
    userId: user.id,
    email: user.email,
    tenantId: tenant.id,
    tenantOwnerId: tenant.userId,
    workspaces,
    isAdmin,
    activeWorkspaceId,
  };

  // Le cache par utilisateur ne garde que l'espace par défaut : un espace demandé est relu à chaque fois.
  if (!preferredTenantId) {
    contextCache.set(user.id, { ctx, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return ctx;
}

/**
 * Le tenant désigné par `tenantId` (id du tenant Hub relié au provisionnement, ou id local), s'il est
 * actif et que l'utilisateur en est propriétaire ou membre non retiré.
 */
async function tenantOfUser(userId: string, tenantId: string): Promise<{ id: string; userId: string } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) return null;
  const t = await prisma.tenant.findFirst({
    where: { OR: [{ hubTenantId: tenantId }, { id: tenantId }], deletedAt: null },
    select: { id: true, userId: true },
  });
  if (!t) return null;
  if (t.userId === userId) return t;
  const m = await prisma.workspaceMember.findFirst({
    where: { userId, deletedAt: null, workspace: { tenantId: t.id, deletedAt: null } },
    select: { userId: true },
  });
  return m ? t : null;
}

/**
 * Espace désigné par le `tenant_id` signé du Hub (CONTRAT-MCP §2), sans repli silencieux :
 * relié à aucun tenant local = `tenant_not_linked` ; relié mais l'utilisateur n'en est ni
 * propriétaire ni membre = `tenant_forbidden` ; sinon l'id local du tenant.
 */
export async function espaceHub(
  userId: string,
  hubTenantId: string,
): Promise<{ id: string } | "tenant_not_linked" | "tenant_forbidden"> {
  const t = await prisma.tenant.findFirst({
    where: { hubTenantId, deletedAt: null },
    select: { id: true, userId: true },
  });
  if (!t) return "tenant_not_linked";
  if (t.userId === userId) return { id: t.id };
  const m = await prisma.workspaceMember.findFirst({
    where: { userId, deletedAt: null, workspace: { tenantId: t.id, deletedAt: null } },
    select: { userId: true },
  });
  return m ? { id: t.id } : "tenant_forbidden";
}

export async function requireUser(): Promise<{ ctx: UserContext } | AuthFailure> {
  const ctx = await getUserContext();
  if (!ctx) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ctx };
}

export async function requireAdmin(): Promise<{ ctx: UserContext } | AuthFailure> {
  const result = await requireUser();
  if ("error" in result) return result;
  if (!result.ctx.isAdmin) {
    return {
      error: NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 }),
    };
  }
  return { ctx: result.ctx };
}

export async function getWorkspaceScope(): Promise<{
  ctx: UserContext | null;
  filter: string[] | null;
  insertId: string | null;
  userFilter: string | null;
}> {
  const ctx = await getUserContext();
  if (!ctx) return { ctx: null, filter: null, insertId: null, userFilter: null };
  return {
    ctx,
    filter: getWorkspaceFilter(ctx),
    insertId: await resolveInsertWorkspaceId(ctx),
    userFilter: getUserFilter(ctx),
  };
}

export function getUserFilter(ctx: UserContext): string | null {
  if (ctx.isAdmin) return null;
  const active =
    ctx.workspaces.find((w) => w.id === ctx.activeWorkspaceId) ??
    ctx.workspaces[0];
  if (!active) return null;
  return active.visibilityScope === "own" ? ctx.userId : null;
}

export function getWorkspaceFilter(ctx: UserContext): string[] | null {
  if (ctx.isAdmin) return null;
  return ctx.workspaces.map((w) => w.id);
}

export async function resolveInsertWorkspaceId(
  ctx: UserContext,
): Promise<string | null> {
  if (ctx.activeWorkspaceId) return ctx.activeWorkspaceId;
  if (ctx.workspaces.length > 0) return ctx.workspaces[0].id;
  try {
    const def = await prisma.workspace.findFirst({
      where: { tenantId: ctx.tenantId, slug: "default" },
      select: { id: true },
    });
    return def?.id ?? null;
  } catch {
    return null;
  }
}

export function invalidateUserContext(userId: string) {
  contextCache.delete(userId);
}

export function invalidateAllUserContexts() {
  contextCache.clear();
}
