import { createClient } from "@supabase/supabase-js";

// Cache tenant_id lookups per request (user_id → tenant_id)
const tenantCache = new Map<string, { id: string; expiresAt: number }>();

// Supabase admin client for tenant lookups (reads from Supabase Postgres, not prospection DB)
// Tries SUPABASE_URL (internal Kong) first, falls back to NEXT_PUBLIC_SUPABASE_URL (public)
function getSupabaseAdmin() {
  const internalUrl = process.env.SUPABASE_URL;
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = internalUrl || publicUrl;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Fallback admin client using public URL (when internal Kong is unreachable) */
function getSupabaseAdminFallback() {
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!publicUrl || !key) return null;
  // Only useful if SUPABASE_URL (internal) differs from NEXT_PUBLIC
  if (publicUrl === (process.env.SUPABASE_URL || publicUrl)) return null;
  return createClient(publicUrl, key);
}

/**
 * Get the tenant ID for a Supabase user.
 * Uses Supabase API (not Prisma) since tenants table lives in Supabase Postgres.
 * Caches results for 60 seconds.
 */
export async function getTenantId(userId: string): Promise<string | null> {
  // Check cache
  const cached = tenantCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.id;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    // No Supabase configured — internal tool mode
    return null;
  }

  let tenant: { id: string } | null = null;
  let lastError: string | null = null;

  const { data, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!error && data) {
    tenant = data;
  } else {
    lastError = error?.message || "no tenant row";
    // Fallback: try public URL if internal Kong failed
    const fallback = getSupabaseAdminFallback();
    if (fallback) {
      console.warn(`[getTenantId] Primary lookup failed (${lastError}), trying public URL fallback...`);
      const { data: fbData, error: fbError } = await fallback
        .from("tenants")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!fbError && fbData) {
        tenant = fbData;
        console.log(`[getTenantId] Fallback succeeded for user ${userId}`);
      } else {
        lastError = fbError?.message || "no tenant row (fallback)";
      }
    }
  }

  if (!tenant) {
    console.warn(`[getTenantId] Tenant not found for user ${userId}:`, lastError);
    return null;
  }

  tenantCache.set(userId, {
    id: tenant.id,
    expiresAt: Date.now() + 60_000,
  });

  return tenant.id;
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

/** Prospect limits per plan — configurable via env vars */
const PLAN_LIMITS: Record<string, number> = {
  freemium: parseInt(process.env.PLAN_LIMIT_FREEMIUM || "300", 10),
  pro: parseInt(process.env.PLAN_LIMIT_PRO || "100000", 10),
  enterprise: parseInt(process.env.PLAN_LIMIT_ENTERPRISE || "500000", 10),
};

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
  // Check cache first
  const cached = planCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.limit;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return Infinity;

  // Try direct tenant lookup
  let plan = "freemium";
  const { data: tenant } = await supabase
    .from("tenants")
    .select("prospection_plan")
    .eq("user_id", userId)
    .maybeSingle();

  if (tenant?.prospection_plan) {
    plan = tenant.prospection_plan;
  } else {
    // Invited member fallback: resolve via workspace_members
    try {
      const { prisma } = await import("@/lib/prisma");
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId },
        include: { workspace: true },
      });
      if (membership?.workspace?.tenantId) {
        const { data: memberTenant } = await supabase
          .from("tenants")
          .select("prospection_plan")
          .eq("id", membership.workspace.tenantId)
          .maybeSingle();
        if (memberTenant?.prospection_plan) {
          plan = memberTenant.prospection_plan;
        }
      }
    } catch { /* fail open */ }
  }

  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.freemium;
  planCache.set(userId, { limit, expiresAt: Date.now() + PLAN_CACHE_TTL_MS });
  return limit;
}
