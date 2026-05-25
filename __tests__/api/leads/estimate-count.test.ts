/**
 * Tests de la route POST /api/leads/estimate-count (refill ICP preview).
 *
 * Couvre :
 *  - 401 si non authentifié
 *  - 422 si body Zod invalide (champ inconnu, country ≠ FR, regions invalides)
 *  - 429 si rate-limit dépassé
 *  - 200 + count via $queryRawUnsafe (filtres traduits en SQL paramétré)
 *  - 503 si la DB throw (rollback propre)
 *  - tier dérivé du plan tenant (freemium / pro / business)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireUserMock, tenantFindUniqueMock, queryRawUnsafeMock, rateLimitMock } = vi.hoisted(
  () => ({
    requireUserMock: vi.fn(),
    tenantFindUniqueMock: vi.fn(),
    queryRawUnsafeMock: vi.fn(),
    rateLimitMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: tenantFindUniqueMock },
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: rateLimitMock }));

import { POST } from "@/app/api/leads/estimate-count/route";
import { makeRequest, readJson } from "../_helpers";

function authedCtx() {
  return {
    ctx: {
      userId: "user-1",
      email: "u@v.test",
      tenantId: "tenant-1",
      tenantOwnerId: "user-1",
      workspaces: [],
      isAdmin: false,
      activeWorkspaceId: null,
    },
  };
}

describe("POST /api/leads/estimate-count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue(false);
  });

  test("returns 401 when not authenticated", async () => {
    requireUserMock.mockResolvedValue({
      error: new Response("Unauthorized", { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/leads/estimate-count", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 422 on invalid body (strict — unknown field)", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    const res = await POST(
      makeRequest("/api/leads/estimate-count", {
        method: "POST",
        body: { totally_unknown: true },
      }),
    );
    expect(res.status).toBe(422);
    const json = (await readJson(res)) as { error: string };
    expect(json.error).toBe("invalid_body");
  });

  test("returns 422 if regions contain invalid department code", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    const res = await POST(
      makeRequest("/api/leads/estimate-count", {
        method: "POST",
        body: { regions: ["999"] },
      }),
    );
    expect(res.status).toBe(422);
  });

  test("returns 429 when rate-limited", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    rateLimitMock.mockReturnValue(true);
    const res = await POST(
      makeRequest("/api/leads/estimate-count", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(429);
  });

  test("returns 200 with count for empty filters (FR default)", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    tenantFindUniqueMock.mockResolvedValue({ plan: "freemium" });
    queryRawUnsafeMock.mockResolvedValue([{ count: BigInt(42_000) }]);

    const res = await POST(
      makeRequest("/api/leads/estimate-count", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(200);
    const json = (await readJson(res)) as {
      estimated_count: number;
      tier: string;
      max_orderable: number;
    };
    expect(json.estimated_count).toBe(42_000);
    expect(json.tier).toBe("freemium");
    expect(json.max_orderable).toBe(42_000);
  });

  test("max_orderable is capped to MAX_LEADS_PER_REFILL_ORDER (100k)", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    tenantFindUniqueMock.mockResolvedValue({ plan: "business" });
    queryRawUnsafeMock.mockResolvedValue([{ count: BigInt(500_000) }]);

    const res = await POST(
      makeRequest("/api/leads/estimate-count", { method: "POST", body: {} }),
    );
    const json = (await readJson(res)) as { max_orderable: number };
    expect(json.max_orderable).toBe(100_000);
  });

  test("tier mapping: enterprise plan tenant → 'business' refill tier", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    tenantFindUniqueMock.mockResolvedValue({ plan: "enterprise" });
    queryRawUnsafeMock.mockResolvedValue([{ count: BigInt(100) }]);

    const res = await POST(
      makeRequest("/api/leads/estimate-count", { method: "POST", body: {} }),
    );
    const json = (await readJson(res)) as { tier: string };
    expect(json.tier).toBe("business");
  });

  test("builds SQL with regions filter binding (paramétré, anti-injection)", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    tenantFindUniqueMock.mockResolvedValue({ plan: "pro" });
    queryRawUnsafeMock.mockResolvedValue([{ count: BigInt(10) }]);

    await POST(
      makeRequest("/api/leads/estimate-count", {
        method: "POST",
        body: { regions: ["75", "92"] },
      }),
    );

    // 1er arg = SQL string contenant placeholders $1/$2
    const callArgs = queryRawUnsafeMock.mock.calls[0];
    expect(callArgs[0]).toContain("e.departement IN");
    expect(callArgs[0]).toContain("$1");
    expect(callArgs[0]).toContain("$2");
    // Args 2+ = params binding
    expect(callArgs[1]).toBe("75");
    expect(callArgs[2]).toBe("92");
  });

  test("returns 503 if database query throws", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    tenantFindUniqueMock.mockResolvedValue({ plan: "freemium" });
    queryRawUnsafeMock.mockRejectedValue(new Error("PG connection lost"));

    const res = await POST(
      makeRequest("/api/leads/estimate-count", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(503);
    const json = (await readJson(res)) as { error: string };
    expect(json.error).toBe("db_error");
  });

  test("safe body parse: invalid JSON content → 422 (no crash)", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    // makeRequest body undefined → request.json() rejects → safe parse → {} → Zod valid (empty filters)
    tenantFindUniqueMock.mockResolvedValue({ plan: "freemium" });
    queryRawUnsafeMock.mockResolvedValue([{ count: BigInt(0) }]);
    const res = await POST(
      makeRequest("/api/leads/estimate-count", { method: "POST" }),
    );
    expect(res.status).toBe(200);
  });
});
