/**
 * Trial expiration check — freemium gating.
 *
 * Hack temporaire : `checkTrialExpired` retourne toujours `false`
 * (cf. CLAUDE.md prospection §"Hacks connus").
 *
 * Historique :
 *  - 2026-04-06 : incident HTTP 429 sur Kong à cause de `admin.auth.admin.getUserById`
 *    appelé sur chaque /api/prospects → fonction stubée à `return false`.
 *  - 2026-04-10 : tentative de re-implémentation Supabase-side (lecture
 *    `tenants.trial_ends_at` via service role).
 *  - 2026-05-XX : migration Auth.js v5 — Supabase n'est plus la source
 *    d'auth, et les colonnes `prospection_plan` / `trial_ends_at` ne sont
 *    pas encore dans le modèle Prisma `Tenant` local. On reste en stub
 *    `false` jusqu'à ce que la logique de plan soit recâblée sur Stripe
 *    (source de vérité billing).
 *
 * Quand on rebranchera : lecture via `prisma.tenant.findFirst` après
 * ajout des colonnes au schema, plus de fallback Supabase admin.
 */

const trialCache = new Map<string, { expired: boolean; expiresAt: number }>();
const TRIAL_CACHE_TTL_MS = 5 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function checkTrialExpired(_userId: string): Promise<boolean> {
  return false;
}

/**
 * Test-only hooks. Not part of the public API — do not import from app code.
 */
export const __trialInternals = {
  clearCache: () => trialCache.clear(),
  getCacheSize: () => trialCache.size,
  TRIAL_CACHE_TTL_MS,
};
