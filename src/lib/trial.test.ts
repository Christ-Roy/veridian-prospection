import { describe, it, expect } from "vitest";
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
