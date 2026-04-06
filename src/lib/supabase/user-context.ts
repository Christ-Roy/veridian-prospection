/**
 * User context resolution for SaaS mode.
 *
 * Resolves from a Supabase-authenticated user:
 *  - userId / email
 *  - tenantId (from Supabase public.tenants.user_id)
 *  - workspaces the user belongs to (from prospection DB workspace_members)
 *  - isAdmin (true if user owns the tenant OR has at least one admin membership)
 *
 * Cf. roadmap/09-workspaces-multi-user.md
 */
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { PrismaClient } from "@prisma/client";

// Reuse a single Prisma client across invocations in dev
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type WorkspaceMembership = {
  id: string;
  name: string;
  slug: string;
  role: "admin" | "member";
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

// In-memory cache per-request (cleared when process restarts)
const contextCache = new Map<string, { ctx: UserContext; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseAdminClient(url, key);
}

/**
 * Extract the authenticated Supabase user from cookies.
 * Returns null if no user (anonymous) or Supabase not configured.
 */
async function getAuthUser(): Promise<{ id: string; email: string } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      set(_n: string, _v: string, _o: CookieOptions) {},
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      remove(_n: string, _o: CookieOptions) {},
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { id: user.id, email: user.email ?? "" };
}

/**
 * Resolve full UserContext for the currently authenticated user.
 * Returns null if no user is logged in or if tenant cannot be resolved.
 */
export async function getUserContext(): Promise<UserContext | null> {
  const user = await getAuthUser();
  if (!user) return null;

  // Check cache
  const cached = contextCache.get(user.id);
  if (cached && cached.expiresAt > Date.now()) {
    // Refresh activeWorkspaceId from cookie (it can change between requests)
    const cookieStore = await cookies();
    const active = cookieStore.get("active_workspace_id")?.value || null;
    return { ...cached.ctx, activeWorkspaceId: active };
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    console.warn("[user-context] Supabase admin client not configured");
    return null;
  }

  // 1) Tenant — try direct ownership first, then fall back to workspace membership
  let tenant: { id: string; user_id: string } | null = null;

  const { data: directTenant, error: tenantErr } = await admin
    .from("tenants")
    .select("id, user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!tenantErr && directTenant) {
    tenant = directTenant;
  } else {
    // Invited member fallback: resolve tenant via workspace_members
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      include: { workspace: true },
    });
    if (membership?.workspace?.tenantId) {
      const { data: memberTenant } = await admin
        .from("tenants")
        .select("id, user_id")
        .eq("id", membership.workspace.tenantId)
        .maybeSingle();
      if (memberTenant) tenant = memberTenant;
    }
  }

  if (!tenant) {
    console.warn(`[user-context] No tenant for user ${user.id}: ${tenantErr?.message || "not found"}`);
    return null;
  }

  // 2) Workspaces (from prospection DB, filtered to this tenant)
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    include: { workspace: true },
  });

  const workspaces: WorkspaceMembership[] = memberships
    .filter((m) => m.workspace.tenantId === tenant.id)
    .map((m) => ({
      id: m.workspaceId,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: (m.role as "admin" | "member") ?? "member",
      visibilityScope:
        (m.visibilityScope as "all" | "own") ?? "all",
    }));

  // 3) Is the user the tenant owner? (implicit admin — never revoked)
  const isOwner = tenant.user_id === user.id;
  const hasAdminMembership = workspaces.some((w) => w.role === "admin");
  const isAdmin = isOwner || hasAdminMembership;

  // 4) Active workspace from cookie (fallback to first workspace, or null for admins with no membership yet)
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
    tenantOwnerId: tenant.user_id,
    workspaces,
    isAdmin,
    activeWorkspaceId,
  };

  contextCache.set(user.id, { ctx, expiresAt: Date.now() + CACHE_TTL_MS });
  return ctx;
}

/**
 * Require an authenticated user. Returns { ctx } or { error: 401 }.
 */
export async function requireUser(): Promise<{ ctx: UserContext } | AuthFailure> {
  const ctx = await getUserContext();
  if (!ctx) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ctx };
}

/**
 * Require an admin user. Returns { ctx } or { error: 401/403 }.
 */
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

/**
 * Resolve both the workspace SELECT filter and the INSERT workspace id
 * for the currently authenticated user. If no user context can be resolved
 * (internal-tool mode, no Supabase), returns { filter: null, insertId: null }
 * so callers degrade to the legacy tenant-only behavior.
 */
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

/**
 * userFilter: returns ctx.userId if the user's *active* workspace membership
 * has visibility_scope='own' AND they're not an admin. Otherwise null (see all).
 * Callers should add `{ userId: userFilter }` to their queries when it's set.
 */
export function getUserFilter(ctx: UserContext): string | null {
  if (ctx.isAdmin) return null;
  // Find the membership for the active workspace (fallback: first)
  const active =
    ctx.workspaces.find((w) => w.id === ctx.activeWorkspaceId) ??
    ctx.workspaces[0];
  if (!active) return null;
  return active.visibilityScope === "own" ? ctx.userId : null;
}

/**
 * Workspace filter for SELECT queries.
 * - Admin users: returns null (no filter — see everything in the tenant).
 * - Members: returns the list of workspace IDs they belong to.
 */
export function getWorkspaceFilter(ctx: UserContext): string[] | null {
  if (ctx.isAdmin) return null;
  return ctx.workspaces.map((w) => w.id);
}

/**
 * Resolve the workspace ID to use on INSERTs.
 * - If the user has an active workspace (cookie), use it.
 * - Admin without active workspace: fallback to the tenant's "default" workspace.
 * - Returns null if nothing can be resolved (writes will have workspace_id=null — acceptable backward-compat).
 */
export async function resolveInsertWorkspaceId(ctx: UserContext): Promise<string | null> {
  if (ctx.activeWorkspaceId) return ctx.activeWorkspaceId;
  if (ctx.workspaces.length > 0) return ctx.workspaces[0].id;
  // Admin with no membership — look up the tenant's default workspace
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

/**
 * Invalidate the in-memory context cache for a user.
 * Call this after mutations that affect memberships or roles.
 */
export function invalidateUserContext(userId: string) {
  contextCache.delete(userId);
}

/**
 * Invalidate cache for all users (e.g. after a workspace rename).
 */
export function invalidateAllUserContexts() {
  contextCache.clear();
}
