/**
 * Trial expiration check — freemium gating.
 *
 * 2026-05-08: Migration depuis Supabase vers Prisma local.
 * Lit prospection_plan + trial_ends_at depuis la table tenants Prisma.
 * Cached 5 min par userId.
 */
import { prisma } from "@/lib/prisma";

const trialCache = new Map<string, { expired: boolean; expiresAt: number }>();
const TRIAL_CACHE_TTL_MS = 5 * 60 * 1000;

type TenantTrialRow = {
  prospectionPlan: string | null;
  trialEndsAt: Date | null;
};

async function fetchTenantTrial(userId: string): Promise<TenantTrialRow | null> {
  const direct = await prisma.tenant.findFirst({
    where: { userId, deletedAt: null },
    select: { prospectionPlan: true, trialEndsAt: true },
  });
  if (direct) return direct;

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
    include: { workspace: true },
  });
  if (!membership?.workspace?.tenantId) return null;

  return prisma.tenant.findUnique({
    where: { id: membership.workspace.tenantId },
    select: { prospectionPlan: true, trialEndsAt: true },
  });
}

export async function checkTrialExpired(userId: string): Promise<boolean> {
  if (!userId || userId === "internal") return false;

  const cached = trialCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.expired;
  }

  let expired = false;
  try {
    const tenant = await fetchTenantTrial(userId);
    const plan = tenant?.prospectionPlan ?? "freemium";
    if (plan === "pro" || plan === "enterprise") {
      expired = false;
    } else if (tenant?.trialEndsAt) {
      expired = tenant.trialEndsAt.getTime() < Date.now();
    } else {
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

export const __trialInternals = {
  clearCache: () => trialCache.clear(),
  getCacheSize: () => trialCache.size,
  TRIAL_CACHE_TTL_MS,
};
