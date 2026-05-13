/**
 * Auth.js v5 user context resolution — remplace src/lib/supabase/user-context.ts
 *
 * Stratégie : expose la MÊME API que l'ancien module Supabase pour permettre
 * un refactor progressif des 73 fichiers consumers (lots A/B/C).
 *
 * Différences vs version Supabase :
 *  - Lit la session via `auth()` Auth.js v5 (cookies JWT) au lieu de Supabase cookies
 *  - Résout le tenant via la table locale `Tenant` (Prisma) au lieu de
 *    `admin.from("tenants")` Supabase
 *  - Pas de Supabase admin client → plus de risque rate-limit
 *
 * Cache 30s identique à l'original.
 */
import { auth } from "@/lib/auth";
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

  const cached = contextCache.get(user.id);
  if (cached && cached.expiresAt > Date.now()) {
    const cookieStore = await cookies();
    const active = cookieStore.get("active_workspace_id")?.value || null;
    return { ...cached.ctx, activeWorkspaceId: active };
  }

  // 1) Tenant (local Prisma) — direct ownership puis fallback membership
  let tenant: { id: string; userId: string } | null = null;

  const directTenant = await prisma.tenant.findFirst({
    where: { userId: user.id, deletedAt: null },
    select: { id: true, userId: true },
  });

  if (directTenant) {
    tenant = directTenant;
  } else {
    // Fallback : membre invité — résout le tenant via workspace_members
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      include: { workspace: true },
    });
    if (membership?.workspace?.tenantId) {
      const memberTenant = await prisma.tenant.findUnique({
        where: { id: membership.workspace.tenantId },
        select: { id: true, userId: true },
      });
      if (memberTenant) tenant = memberTenant;
    }
  }

  if (!tenant) {
    console.warn(`[user-context] No tenant for user ${user.id}`);
    return null;
  }

  // 2) Workspaces (Prisma local, filtré au tenant)
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
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
  const cookieStore = await cookies();
  const activeCookie = cookieStore.get("active_workspace_id")?.value || null;
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

  contextCache.set(user.id, { ctx, expiresAt: Date.now() + CACHE_TTL_MS });
  return ctx;
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
