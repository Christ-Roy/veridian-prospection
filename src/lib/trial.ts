/**
 * Trial expiration check — freemium gating.
 *
 * Re-enabled 2026-04-10 (P0.1). Previously stubbed to `return false` after
 * the 2026-04-06 incident where the old implementation called Supabase admin
 * API (`getUserById`) on every /api/prospects request → HTTP 429 on Kong.
 *
 * New contract:
 *  - Lookup the tenant via `workspace_members` (same pattern as
 *    `getTenantProspectLimit` in src/lib/supabase/tenant.ts).
 *  - Result cached per-userId for 5 minutes to avoid rate limiting.
 *  - Returns true only when the tenant is freemium AND trial_ends_at is in
 *    the past. Paid plans (pro / enterprise) always return false.
 *
 * No call to `admin.auth.admin.*` — only Postgres SELECTs on the tenants
 * table via the service role. Those are cheap and cached here anyway.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Separate cache from planCache so we don't couple the two lookups.
const trialCache = new Map<string, { expired: boolean; expiresAt: number }>();
const TRIAL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

type TenantTrialRow = {
  prospection_plan?: string | null;
  trial_ends_at?: string | null;
};

async function fetchTenantTrial(
  admin: SupabaseClient,
  userId: string,
): Promise<TenantTrialRow | null> {
  // 1. Direct lookup (tenant owner)
  const { data: direct } = await admin
    .from("tenants")
    .select("prospection_plan, trial_ends_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (direct) return direct;

  // 2. Invited member fallback via workspace_members → workspace.tenantId
  try {
    const { prisma } = await import("@/lib/prisma");
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId },
      include: { workspace: true },
    });
    if (!membership?.workspace?.tenantId) return null;

    const { data: memberTenant } = await admin
      .from("tenants")
      .select("prospection_plan, trial_ends_at")
      .eq("id", membership.workspace.tenantId)
      .maybeSingle();
    return memberTenant ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the user's freemium trial has expired and they have no
 * paid plan. Cached for 5 minutes. Fails open (returns false) on any error.
 *
 * Exported for tests via __trialInternals below.
 */
export async function checkTrialExpired(userId: string): Promise<boolean> {
  if (!userId || userId === "internal") return false;

  const cached = trialCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.expired;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    // No Supabase configured → internal tool mode, never expired.
    return false;
  }

  let expired = false;
  try {
    const tenant = await fetchTenantTrial(admin, userId);

    // Paid plans never expire (Stripe is source of truth for billing).
    const plan = tenant?.prospection_plan ?? "freemium";
    if (plan === "pro" || plan === "enterprise") {
      expired = false;
    } else if (tenant?.trial_ends_at) {
      expired = new Date(tenant.trial_ends_at).getTime() < Date.now();
    } else {
      // Unknown tenant or missing trial_ends_at → fail open.
      expired = false;
    }
  } catch (err) {
    console.warn(`[checkTrialExpired] lookup failed for ${userId}:`, err);
    expired = false;
  }

  trialCache.set(userId, {
    expired,
    expiresAt: Date.now() + TRIAL_CACHE_TTL_MS,
  });
  return expired;
}

/**
 * Test-only hooks. Not part of the public API — do not import from app code.
 */
export const __trialInternals = {
  clearCache: () => trialCache.clear(),
  getCacheSize: () => trialCache.size,
  TRIAL_CACHE_TTL_MS,
};
