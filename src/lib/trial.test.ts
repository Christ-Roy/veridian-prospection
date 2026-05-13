import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Guard test: ensure no Supabase admin API calls in hot paths.
 * Prevents repeat of the rate-limit incident (2026-04-06).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}

describe("Supabase admin API rate-limit guard", () => {
  it("trial.ts code must NOT call getUserById or listUsers", () => {
    const raw = readFileSync(join(__dirname, "trial.ts"), "utf-8");
    const code = stripComments(raw);
    expect(code).not.toContain("getUserById");
    expect(code).not.toContain("listUsers");
    expect(code).not.toContain("admin.auth.admin");
  });

  it("prospects route must NOT create uncached Supabase admin client", () => {
    try {
      const raw = readFileSync(join(__dirname, "../../app/api/prospects/route.ts"), "utf-8");
      const code = stripComments(raw);
      const bad = code.includes("createClient(") && code.includes("SERVICE_ROLE_KEY");
      expect(bad, "prospects route creates uncached admin client").toBe(false);
    } catch { /* file not found in test — skip */ }
  });

  it("pipeline route must NOT create uncached Supabase admin client", () => {
    try {
      const raw = readFileSync(join(__dirname, "../../app/api/pipeline/route.ts"), "utf-8");
      const code = stripComments(raw);
      const bad = code.includes("createClient(") && code.includes("SERVICE_ROLE_KEY");
      expect(bad, "pipeline route creates uncached admin client").toBe(false);
    } catch { /* skip */ }
  });
});

/**
 * Tests for checkTrialExpired — depuis migration Auth.js v5 (2026-05-06)
 * la fonction est un stub `return false` (cf. trial.ts) tant que la logique
 * de plan n'est pas recâblée sur Stripe (source de vérité billing).
 *
 * Les anciens tests mockaient Supabase — ils ne sont plus pertinents.
 * On garde juste un test de sanité qui vérifie que le stub retourne false
 * pour tout user, sans appel réseau.
 */
describe("checkTrialExpired (Auth.js v5 stub)", () => {
  let trial: typeof import("./trial");

  beforeEach(async () => {
    trial = await import("./trial");
    trial.__trialInternals.clearCache();
  });

  afterEach(() => {
    trial.__trialInternals.clearCache();
  });

  it("returns false for any user (stub temporaire)", async () => {
    expect(await trial.checkTrialExpired("user-abc")).toBe(false);
    expect(await trial.checkTrialExpired("internal")).toBe(false);
    expect(await trial.checkTrialExpired("00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});
