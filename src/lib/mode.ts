/**
 * Dev vs Prod mode detection.
 * Based on NEXT_PUBLIC_SUPABASE_URL presence:
 * - Set → prod mode (Supabase auth, SIP enabled, trial from Supabase)
 * - Not set → dev mode (no auth, SIP preview, trial from localStorage)
 */
export function isDevMode(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL;
}
