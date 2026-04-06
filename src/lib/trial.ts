/**
 * Check if a user's free trial has expired.
 *
 * DISABLED: server-side obfuscation was calling Supabase admin API
 * (getUserById) on every /api/prospects request → rate limit 429.
 * Real billing protection will be Stripe checkout + paywall modal.
 * TODO: re-enable with proper in-memory caching when Stripe is wired.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function checkTrialExpired(_userId: string): Promise<boolean> {
  return false;
}
