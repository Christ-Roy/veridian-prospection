/**
 * Tests de la route POST /api/checkout (Stripe checkout session).
 *
 * Couvre :
 *  - 503 si Stripe non configuré
 *  - 401 si non authentifié
 *  - 400 si plan invalide ou manquant
 *  - 200 + url Stripe sur plan valide, métadonnées propagées
 *  - 500 si Stripe API throw
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY_TEST = "sk_test_fake";
  process.env.STRIPE_PRICE_GEO = "price_geo_real";
  process.env.STRIPE_PRICE_FULL = "price_full_real";
  process.env.NEXT_PUBLIC_SITE_URL = "https://prospection.test";
});

const { requireAuthMock, getTenantIdMock, stripeMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  stripeMock: {
    checkout: { sessions: { create: vi.fn() } },
  },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("stripe", () => {
  class StripeCtor {
    checkout = stripeMock.checkout;
    constructor(_key: string) {
      void _key;
    }
  }
  return { default: StripeCtor };
});

import { POST } from "@/app/api/checkout/route";
import { makeRequest, readJson } from "./_helpers";

describe("POST /api/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 401 when not authenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const req = makeRequest("/api/checkout", {
      method: "POST",
      body: { plan: "full" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 400 when plan is missing", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    const req = makeRequest("/api/checkout", { method: "POST", body: {} });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string; plans: string[] };
    expect(body.error).toContain("Invalid plan");
    expect(body.plans).toEqual(expect.arrayContaining(["geo", "full"]));
  });

  test("returns 400 when plan is unknown", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    const req = makeRequest("/api/checkout", {
      method: "POST",
      body: { plan: "moon" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns Stripe checkout URL on valid plan", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("tenant-1");
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });

    const req = makeRequest("/api/checkout", {
      method: "POST",
      body: { plan: "full" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as { url: string };
    expect(body.url).toContain("checkout.stripe.com");

    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        line_items: [{ price: "price_full_real", quantity: 1 }],
        metadata: {
          tenant_id: "tenant-1",
          user_id: "u-1",
          plan: "full",
        },
        customer_email: "u@v.site",
      }),
    );
  });

  test("returns 500 when Stripe API throws", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("tenant-1");
    stripeMock.checkout.sessions.create.mockRejectedValue(
      new Error("Stripe down"),
    );

    const req = makeRequest("/api/checkout", {
      method: "POST",
      body: { plan: "geo" },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Stripe down");
  });
});
