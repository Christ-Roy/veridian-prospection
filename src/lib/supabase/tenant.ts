/**
 * Tenant + plan resolution.
 * 2026-05-08: Migration depuis Supabase vers Prisma local. Plus de dépendance
 * Supabase pour le plan/trial. Le Hub (via Stripe webhooks) update directement
 * la table tenants en Postgres prospection.
 */
import { prisma } from "@/lib/prisma";

const tenantCache = new Map<string, { id: string; expiresAt: number }>();
const TENANT_CACHE_TTL_MS = 60_000;

/**
 * Get the tenant ID for a user.
 * Tries direct ownership first, then falls back to workspace_members for invited users.
 */
export async function getTenantId(userId: string): Promise<string | null> {
  const cached = tenantCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.id;
  }

  const direct = await prisma.tenant.findFirst({
    where: { userId, deletedAt: null },
    select: { id: true },
  });

  let tenantId: string | null = direct?.id ?? null;

  if (!tenantId) {
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId },
      include: { workspace: true },
    });
    if (membership?.workspace?.tenantId) {
      tenantId = membership.workspace.tenantId;
    }
  }

  if (!tenantId) {
    return null;
  }

  tenantCache.set(userId, { id: tenantId, expiresAt: Date.now() + TENANT_CACHE_TTL_MS });
  return tenantId;
}

export async function requireTenantId(userId: string): Promise<string> {
  const tenantId = await getTenantId(userId);
  if (!tenantId) {
    throw new Error("Tenant not found for user");
  }
  return tenantId;
}

const PLAN_LIMITS: Record<string, number> = {
  freemium: parseInt(process.env.PLAN_LIMIT_FREEMIUM || "300", 10),
  pro: parseInt(process.env.PLAN_LIMIT_PRO || "100000", 10),
  enterprise: parseInt(process.env.PLAN_LIMIT_ENTERPRISE || "500000", 10),
};

const planCache = new Map<string, { limit: number; expiresAt: number }>();
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Get the prospect limit for a tenant based on their plan.
 */
export async function getTenantProspectLimit(userId: string): Promise<number> {
  const cached = planCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.limit;
  }

  let plan = "freemium";

  const direct = await prisma.tenant.findFirst({
    where: { userId, deletedAt: null },
    select: { prospectionPlan: true },
  });

  if (direct?.prospectionPlan) {
    plan = direct.prospectionPlan;
  } else {
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId },
      include: { workspace: true },
    });
    if (membership?.workspace?.tenantId) {
      const memberTenant = await prisma.tenant.findUnique({
        where: { id: membership.workspace.tenantId },
        select: { prospectionPlan: true },
      });
      if (memberTenant?.prospectionPlan) {
        plan = memberTenant.prospectionPlan;
      }
    }
  }

  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.freemium;
  planCache.set(userId, { limit, expiresAt: Date.now() + PLAN_CACHE_TTL_MS });
  return limit;
}
