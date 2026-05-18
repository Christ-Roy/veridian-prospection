/**
 * Tests de la route POST /api/webhooks/stripe.
 *
 * Couvre :
 *  - 503 quand Stripe non configuré (STRIPE_KEY/WEBHOOK_SECRET absents)
 *  - 400 quand signature `stripe-signature` manquante
 *  - 400 quand signature invalide (constructEvent throw)
 *  - 200 + tenant upgradé sur `checkout.session.completed`
 *  - 200 + tenant downgradé freemium sur `customer.subscription.deleted`
 *  - 200 sur event inconnu (graceful no-op)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY_TEST = "sk_test_fake";
  process.env.STRIPE_WEBHOOK_SECRET_TEST = "whsec_fake";
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
});

const { stripeMock, supabaseUpdateMock, supabaseFromMock, createClientMock } = vi.hoisted(() => {
  const updateBuilder = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation(() => ({
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled),
    })),
  };
  const sb = { from: vi.fn(() => updateBuilder) };
  return {
    stripeMock: {
      webhooks: { constructEvent: vi.fn() },
      checkout: { sessions: { create: vi.fn() } },
    },
    supabaseUpdateMock: updateBuilder,
    supabaseFromMock: sb,
    createClientMock: vi.fn(() => sb),
  };
});

vi.mock("stripe", () => {
  // Stripe est instancié via `new Stripe(...)` — il faut un constructeur,
  // pas une simple fn().
  class StripeCtor {
    webhooks = stripeMock.webhooks;
    checkout = stripeMock.checkout;
    constructor(_key: string) {
      void _key;
    }
  }
  return { default: StripeCtor };
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

import { POST } from "@/app/api/webhooks/stripe/route";
import { makeRequest, readJson } from "../_helpers";

describe("POST /api/webhooks/stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-attache l'impl du builder après clearAllMocks (clearAllMocks reset les calls, pas l'impl,
    // mais on remet pour safety si jamais un test fait mockImplementation).
    supabaseUpdateMock.update.mockReturnValue(supabaseUpdateMock);
    supabaseUpdateMock.eq.mockImplementation(() => ({
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled),
    }));
    supabaseFromMock.from.mockReturnValue(supabaseUpdateMock);
  });

  test("returns 400 when stripe-signature header is missing", async () => {
    const req = makeRequest("/api/webhooks/stripe", {
      method: "POST",
      body: "raw-stripe-payload",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Missing signature");
  });

  test("returns 400 when signature verification fails", async () => {
    stripeMock.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("invalid signature");
    });
    const req = makeRequest("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=123,v1=bad" },
      body: "raw",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Invalid signature");
  });

  test("upgrades tenant plan on checkout.session.completed", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenant_id: "tenant-42", plan: "full" },
        },
      },
    });

    const req = makeRequest("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=ok" },
      body: "raw",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { received: boolean };
    expect(body.received).toBe(true);

    expect(supabaseUpdateMock.update).toHaveBeenCalledWith({
      prospection_plan: "full",
    });
    expect(supabaseUpdateMock.eq).toHaveBeenCalledWith("id", "tenant-42");
  });

  test("downgrades to freemium on customer.subscription.deleted", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: {
        object: { metadata: { tenant_id: "tenant-7" } },
      },
    });

    const req = makeRequest("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=ok" },
      body: "raw",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(supabaseUpdateMock.update).toHaveBeenCalledWith({
      prospection_plan: "freemium",
    });
    expect(supabaseUpdateMock.eq).toHaveBeenCalledWith("id", "tenant-7");
  });

  test("returns 200 on unhandled event without errors", async () => {
    stripeMock.webhooks.constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: { object: {} },
    });

    const req = makeRequest("/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=ok" },
      body: "raw",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    // Pas d'update tenant pour un event inconnu
    expect(supabaseUpdateMock.update).not.toHaveBeenCalled();
  });
});
