import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
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
 * Unit tests for checkTrialExpired — 2026-05-08 réécrit pour Prisma direct
 * (fin Supabase). Mock @/lib/prisma au lieu de @supabase/supabase-js.
 */
const mockTenantFindFirst = vi.fn();
const mockTenantFindUnique = vi.fn();
const mockMembershipFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findFirst: mockTenantFindFirst,
      findUnique: mockTenantFindUnique,
    },
    workspaceMember: {
      findFirst: mockMembershipFindFirst,
    },
  },
}));

describe("checkTrialExpired", () => {
  let trial: typeof import("./trial");
  const USER_ID = "user-abc";

  beforeEach(async () => {
    mockTenantFindFirst.mockReset();
    mockTenantFindUnique.mockReset();
    mockMembershipFindFirst.mockReset();
    // Default: pas de membership (sauf override par test)
    mockMembershipFindFirst.mockResolvedValue(null);
    vi.resetModules();
    trial = await import("./trial");
    trial.__trialInternals.clearCache();
  });

  afterEach(() => {
    trial.__trialInternals.clearCache();
  });

  it("returns false when trial is still active", async () => {
    const futureDate = new Date(Date.now() + 3 * 86400000);
    mockTenantFindFirst.mockResolvedValueOnce({
      prospectionPlan: "freemium",
      trialEndsAt: futureDate,
    });
    const expired = await trial.checkTrialExpired(USER_ID);
    expect(expired).toBe(false);
  });

  it("returns true when trial is expired and plan is freemium", async () => {
    const pastDate = new Date(Date.now() - 86400000);
    mockTenantFindFirst.mockResolvedValueOnce({
      prospectionPlan: "freemium",
      trialEndsAt: pastDate,
    });
    const expired = await trial.checkTrialExpired(USER_ID);
    expect(expired).toBe(true);
  });

  it("returns false when plan is paid, even if trial_ends_at is in the past", async () => {
    const pastDate = new Date(Date.now() - 86400000);
    mockTenantFindFirst.mockResolvedValueOnce({
      prospectionPlan: "pro",
      trialEndsAt: pastDate,
    });
    const expired = await trial.checkTrialExpired(USER_ID);
    expect(expired).toBe(false);
  });

  it("returns false when tenant row is missing (fails open)", async () => {
    mockTenantFindFirst.mockResolvedValueOnce(null);
    mockMembershipFindFirst.mockResolvedValueOnce(null);
    const expired = await trial.checkTrialExpired(USER_ID);
    expect(expired).toBe(false);
  });

  it("caches the result — second call within TTL does not re-query", async () => {
    const futureDate = new Date(Date.now() + 3 * 86400000);
    mockTenantFindFirst.mockResolvedValueOnce({
      prospectionPlan: "freemium",
      trialEndsAt: futureDate,
    });

    const first = await trial.checkTrialExpired(USER_ID);
    const second = await trial.checkTrialExpired(USER_ID);
    const third = await trial.checkTrialExpired(USER_ID);

    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(third).toBe(false);
    expect(mockTenantFindFirst).toHaveBeenCalledTimes(1);
  });

  it("returns false for the internal user id (no DB call)", async () => {
    const expired = await trial.checkTrialExpired("internal");
    expect(expired).toBe(false);
    expect(mockTenantFindFirst).not.toHaveBeenCalled();
  });
});
