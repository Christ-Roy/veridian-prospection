import { prisma } from "@/lib/prisma";

// Cache tenant_id lookups per request (user_id → tenant_id)
const tenantCache = new Map<string, { id: string; expiresAt: number }>();

/**
 * Get the tenant ID for a user.
 * Resolves via Prisma local DB (post-Auth.js v5 migration 2026-05-08).
 * Looks up the user's tenant via the workspace_members → workspaces → tenants chain,
 * with a fallback to the direct tenants.user_id (legacy schema).
 * Caches results for 60 seconds.
 */
export async function getTenantId(userId: string): Promise<string | null> {
  const cached = tenantCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.id;
  }

  // 1. Direct: tenants.user_id (legacy schema kept after Supabase migration)
  const ownTenant = await prisma.tenant.findFirst({
    where: { userId },
    select: { id: true },
  });
  let tenantId = ownTenant?.id ?? null;

  // 2. Fallback: workspace membership (invited users)
  if (!tenantId) {
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId, deletedAt: null },
      select: { workspace: { select: { tenantId: true } } },
    });
    tenantId = membership?.workspace?.tenantId ?? null;
  }

  if (!tenantId) {
    console.warn(`[getTenantId] Tenant not found for user ${userId}`);
    return null;
  }

  tenantCache.set(userId, { id: tenantId, expiresAt: Date.now() + 60_000 });
  return tenantId;
}

/**
 * Get the tenant ID or throw — for routes that require a tenant.
 */
export async function requireTenantId(userId: string): Promise<string> {
  const tenantId = await getTenantId(userId);
  if (!tenantId) {
    throw new Error("Tenant not found for user");
  }
  return tenantId;
}

/**
 * Prospect limits per plan — configurable via env vars.
 *
 * Plans cf CONTRAT-HUB.md §3.3 :
 *  - freemium / starter : payants, quota cap
 *  - pro / enterprise : payants, gros caps
 *  - lifetime_site_vitrine / lifetime_partner / internal : offerts,
 *    quota illimité (Infinity). Immune au downgrade Stripe (§3.3 immunité).
 */
const PLAN_LIMITS: Record<string, number> = {
  freemium: parseInt(process.env.PLAN_LIMIT_FREEMIUM || "300", 10),
  starter: parseInt(process.env.PLAN_LIMIT_STARTER || "5000", 10),
  pro: parseInt(process.env.PLAN_LIMIT_PRO || "100000", 10),
  enterprise: parseInt(process.env.PLAN_LIMIT_ENTERPRISE || "500000", 10),
  // Plans offerts — quota illimité, jamais de downgrade.
  lifetime_site_vitrine: Number.POSITIVE_INFINITY,
  lifetime_partner: Number.POSITIVE_INFINITY,
  internal: Number.POSITIVE_INFINITY,
};

/**
 * Plans considérés comme offerts (gratuits, illimités, immunes au downgrade).
 * Source de vérité §3.3 du contrat.
 */
export const GIFTED_PLANS = new Set([
  "lifetime_site_vitrine",
  "lifetime_partner",
  "internal",
] as const);

/** Retourne true si le plan n'a jamais de trial expiré ni de quota. */
export function isGiftedPlan(plan: string | null | undefined): boolean {
  return typeof plan === "string" && GIFTED_PLANS.has(plan as never);
}

// Cache plan lookups — prevents Supabase admin API rate limiting
// (incident 2026-04-06: uncached calls on every /api/prospects → 429)
const planCache = new Map<string, { limit: number; expiresAt: number }>();
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the prospect limit for a tenant based on their plan.
 * Returns Infinity if no limit (internal/admin), or a number cap.
 * Cached for 5 minutes per user to avoid rate-limiting Supabase.
 */
export async function getTenantProspectLimit(userId: string): Promise<number> {
  const cached = planCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.limit;
  }

  // Raw SQL: prospection_plan column exists in DB but not in Prisma schema.
  // TODO: add field to schema.prisma in a follow-up migration.
  let plan = "freemium";
  try {
    const rows = await prisma.$queryRawUnsafe<{ plan: string | null }[]>(
      `SELECT t.prospection_plan AS plan
       FROM tenants t
       LEFT JOIN workspaces w ON w.tenant_id = t.id
       LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.deleted_at IS NULL
       WHERE t.user_id = $1::uuid OR wm.user_id = $1::uuid
       LIMIT 1`,
      userId,
    );
    if (rows[0]?.plan) plan = rows[0].plan;
  } catch (err) {
    console.warn(`[getTenantProspectLimit] lookup failed for ${userId}:`, err);
  }

  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.freemium;
  planCache.set(userId, { limit, expiresAt: Date.now() + PLAN_CACHE_TTL_MS });
  return limit;
}
