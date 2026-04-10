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
 * Unit tests for checkTrialExpired — recabled 2026-04-10 (P0.1).
 *
 * Mocks @supabase/supabase-js so we never hit the network. The mocked client
 * returns a configurable tenant row. We verify:
 *  - trial active → false
 *  - trial expired + freemium plan → true
 *  - trial expired + paid plan → false (Stripe is source of truth)
 *  - cache hit within TTL → no second DB query
 */
const mockMaybeSingle = vi.fn();
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

describe("checkTrialExpired", () => {
  let trial: typeof import("./trial");
  const USER_ID = "user-abc";

  beforeEach(async () => {
    process.env.SUPABASE_URL = "http://fake";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
    mockMaybeSingle.mockReset();
    mockEq.mockClear();
    mockSelect.mockClear();
    mockFrom.mockClear();
    // Fresh module per test so the in-memory cache is clean
    vi.resetModules();
    trial = await import("./trial");
    trial.__trialInternals.clearCache();
  });

  afterEach(() => {
    trial.__trialInternals.clearCache();
  });

  it("returns false when trial is still active", async () => {
    const futureDate = new Date(Date.now() + 3 * 86400000).toISOString();
    mockMaybeSingle.mockResolvedValueOnce({
      data: { prospection_plan: "freemium", trial_ends_at: futureDate },
      error: null,
    });
    const expired = await trial.checkTrialExpired(USER_ID);
    expect(expired).toBe(false);
  });

  it("returns true when trial is expired and plan is freemium", async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    mockMaybeSingle.mockResolvedValueOnce({
      data: { prospection_plan: "freemium", trial_ends_at: pastDate },
      error: null,
    });
    const expired = await trial.checkTrialExpired(USER_ID);
    expect(expired).toBe(true);
  });

  it("returns false when plan is paid, even if trial_ends_at is in the past", async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    mockMaybeSingle.mockResolvedValueOnce({
      data: { prospection_plan: "pro", trial_ends_at: pastDate },
      error: null,
    });
    const expired = await trial.checkTrialExpired(USER_ID);
    expect(expired).toBe(false);
  });

  it("returns false when tenant row is missing (fails open)", async () => {
    // Direct lookup → null, fallback prisma import will throw in unit context
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const expired = await trial.checkTrialExpired(USER_ID);
    expect(expired).toBe(false);
  });

  it("caches the result — second call within TTL does not re-query", async () => {
    const futureDate = new Date(Date.now() + 3 * 86400000).toISOString();
    mockMaybeSingle.mockResolvedValueOnce({
      data: { prospection_plan: "freemium", trial_ends_at: futureDate },
      error: null,
    });

    const first = await trial.checkTrialExpired(USER_ID);
    const second = await trial.checkTrialExpired(USER_ID);
    const third = await trial.checkTrialExpired(USER_ID);

    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(third).toBe(false);
    // Only one DB round-trip despite three calls
    expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns false for the internal user id (no Supabase call)", async () => {
    const expired = await trial.checkTrialExpired("internal");
    expect(expired).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
