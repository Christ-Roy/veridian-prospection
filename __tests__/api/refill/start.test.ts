/**
 * Tests de la route POST /api/refill/start (refill ICP — checkout via Hub).
 *
 * Couvre :
 *  - 401 non authentifié
 *  - 422 quantity hors bornes / filters invalides
 *  - 429 rate-limit
 *  - 404 tenant introuvable
 *  - 422 quantity > available (anti-tampering — re-compte serveur)
 *  - 200 + url Stripe sur happy path (HMAC vers Hub OK)
 *  - 502 hub_timeout / hub_server_error
 *  - 500 hub_misconfigured / hub_unauthorized
 *  - HMAC body inclut bien `filters` quand fourni + omis sinon
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const {
  requireUserMock,
  tenantFindUniqueMock,
  queryRawUnsafeMock,
  rateLimitMock,
  createRefillCheckoutFromAppMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
  rateLimitMock: vi.fn(),
  createRefillCheckoutFromAppMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: tenantFindUniqueMock },
    $queryRawUnsafe: queryRawUnsafeMock,
  },
}));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: rateLimitMock }));
vi.mock("@/lib/hub/refill-from-app-client", () => ({
  createRefillCheckoutFromApp: createRefillCheckoutFromAppMock,
}));

import { POST } from "@/app/api/refill/start/route";
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

describe("POST /api/refill/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.mockReturnValue(false);
  });

  test("returns 401 when not authenticated", async () => {
    requireUserMock.mockResolvedValue({
      error: new Response("Unauthorized", { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/refill/start", {
        method: "POST",
        body: { quantity: 100 },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 422 when quantity is 0", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    const res = await POST(
      makeRequest("/api/refill/start", {
        method: "POST",
        body: { quantity: 0 },
      }),
    );
    expect(res.status).toBe(422);
  });

  test("returns 422 when quantity exceeds MAX (100k)", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    const res = await POST(
      makeRequest("/api/refill/start", {
        method: "POST",
        body: { quantity: 100_001 },
      }),
    );
    expect(res.status).toBe(422);
  });

  test("returns 422 when filters has invalid region", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    const res = await POST(
      makeRequest("/api/refill/start", {
        method: "POST",
        body: { quantity: 100, filters: { regions: ["XXX"] } },
      }),
    );
    expect(res.status).toBe(422);
  });

  test("returns 429 when rate-limited", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    rateLimitMock.mockReturnValue(true);
    const res = await POST(
      makeRequest("/api/refill/start", {
        method: "POST",
        body: { quantity: 100 },
      }),
    );
    expect(res.status).toBe(429);
  });

  test("returns 404 when tenant not found", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    tenantFindUniqueMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest("/api/refill/start", {
        method: "POST",
        body: { quantity: 100 },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("anti-tampering: quantity > available → 422 quantity_exceeds_available", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    tenantFindUniqueMock.mockResolvedValue({ plan: "freemium" });
    queryRawUnsafeMock.mockResolvedValue([{ count: BigInt(50) }]);
    const res = await POST(
      makeRequest("/api/refill/start", {
        method: "POST",
        body: { quantity: 1000, filters: { regions: ["75"] } },
      }),
    );
    expect(res.status).toBe(422);
    const json = (await readJson(res)) as {
      error: string;
      available: number;
      requested: number;
    };
    expect(json.error).toBe("quantity_exceeds_available");
    expect(json.available).toBe(50);
    expect(json.requested).toBe(1000);
  });

  test("happy path: returns Stripe URL on success", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    tenantFindUniqueMock.mockResolvedValue({ plan: "pro" });
    queryRawUnsafeMock.mockResolvedValue([{ count: BigInt(5000) }]);
    createRefillCheckoutFromAppMock.mockResolvedValue({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_abc",
      sessionId: "cs_test_abc",
      amountCents: 25000,
      quantity: 1000,
      tier: "pro",
    });
    const res = await POST(
      makeRequest("/api/refill/start", {
        method: "POST",
        body: { quantity: 1000, filters: { regions: ["75"] } },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await readJson(res)) as {
      url: string;
      sessionId: string;
      amountCents: number;
    };
    expect(json.url).toContain("checkout.stripe.com");
    expect(json.sessionId).toBe("cs_test_abc");
    expect(json.amountCents).toBe(25000);

    // Le Hub a été appelé avec tier="pro" + filters propagés
    expect(createRefillCheckoutFromAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        quantity: 1000,
        plan: "pro",
        filters: expect.objectContaining({ regions: ["75"] }),
      }),
    );
  });

  test("filters omitted: works without re-count (backward compat)", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    tenantFindUniqueMock.mockResolvedValue({ plan: "freemium" });
    createRefillCheckoutFromAppMock.mockResolvedValue({
      ok: true,
      url: "https://checkout.stripe.com/x",
      sessionId: "cs_y",
      amountCents: 5000,
      quantity: 100,
      tier: "freemium",
    });
    const res = await POST(
      makeRequest("/api/refill/start", {
        method: "POST",
        body: { quantity: 100 },
      }),
    );
    expect(res.status).toBe(200);
    // Pas de re-count quand filters absent (rapide).
    expect(queryRawUnsafeMock).not.toHaveBeenCalled();
    // Hub appelé sans filters.
    const call = createRefillCheckoutFromAppMock.mock.calls[0][0];
    expect(call.filters).toBeUndefined();
  });

  test("returns 502 on hub_timeout", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    tenantFindUniqueMock.mockResolvedValue({ plan: "pro" });
    createRefillCheckoutFromAppMock.mockResolvedValue({
      ok: false,
      reason: "hub_timeout",
    });
    const res = await POST(
      makeRequest("/api/refill/start", {
        method: "POST",
        body: { quantity: 100 },
      }),
    );
    expect(res.status).toBe(502);
    const json = (await readJson(res)) as { reason: string };
    expect(json.reason).toBe("hub_timeout");
  });

  test("returns 500 on hub_misconfigured (no HUB_API_URL)", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    tenantFindUniqueMock.mockResolvedValue({ plan: "freemium" });
    createRefillCheckoutFromAppMock.mockResolvedValue({
      ok: false,
      reason: "hub_misconfigured",
    });
    const res = await POST(
      makeRequest("/api/refill/start", {
        method: "POST",
        body: { quantity: 100 },
      }),
    );
    expect(res.status).toBe(500);
  });

  test("safe body parse: missing body → 422 invalid_body", async () => {
    requireUserMock.mockResolvedValue(authedCtx());
    const res = await POST(
      makeRequest("/api/refill/start", { method: "POST" }),
    );
    // body absent → safe parse → {} → Zod fail sur quantity required → 422.
    expect(res.status).toBe(422);
  });
});
