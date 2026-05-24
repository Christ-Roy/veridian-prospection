/**
 * Tests POST /api/billing/refill-checkout — proxy Prospection → Hub.
 *
 * Couvre :
 *  - 401 si pas d'user authentifié
 *  - 422 si quantity manquante / non-numérique / négative / au-delà du cap
 *  - 404 si tenant introuvable (état dégradé)
 *  - 200 + url Stripe quand le Hub répond OK (avec mock client)
 *  - 502 si le Hub renvoie 5xx
 *  - 500 si HUB_API_URL/SECRET manquants (hub_misconfigured)
 *  - tenantId envoyé au Hub = ctx.tenantId (jamais celui du body — sécurité
 *    cross-tenant)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  tenantFindUnique: vi.fn(),
  createRefillCheckout: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
  },
}));

vi.mock("@/lib/hub/refill-client", () => ({
  createRefillCheckout: mocks.createRefillCheckout,
}));

import { NextResponse } from "next/server";
import { POST } from "@/app/api/billing/refill-checkout/route";
import { makeRequest, makeUserContext, readJson } from "../_helpers";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const WS_ID = "22222222-2222-4222-8222-222222222222";

function authedUser() {
  return {
    ctx: makeUserContext({
      tenantId: TENANT_ID,
      activeWorkspaceId: WS_ID,
      workspaces: [
        {
          id: WS_ID,
          name: "Default",
          slug: "default",
          role: "owner",
          visibilityScope: "all",
        },
      ],
    }),
  };
}

function postReq(body: unknown) {
  return makeRequest("/api/billing/refill-checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(authedUser());
  mocks.tenantFindUnique.mockResolvedValue({ plan: "pro" });
  mocks.createRefillCheckout.mockResolvedValue({
    ok: true,
    url: "https://checkout.stripe.com/c/pay/cs_test_xxx",
    sessionId: "cs_test_xxx",
  });
});

describe("POST /api/billing/refill-checkout — auth + validation", () => {
  test("401 si user non authentifié", async () => {
    mocks.requireUser.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(postReq({ quantity: 500 }));
    expect(res.status).toBe(401);
  });

  test("422 si body invalide (pas d'objet JSON)", async () => {
    const req = makeRequest("/api/billing/refill-checkout", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  test("422 si quantity manquante", async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(422);
  });

  test("422 si quantity négative", async () => {
    const res = await POST(postReq({ quantity: -10 }));
    expect(res.status).toBe(422);
  });

  test("422 si quantity = 0", async () => {
    const res = await POST(postReq({ quantity: 0 }));
    expect(res.status).toBe(422);
  });

  test("422 si quantity dépasse le cap MAX_LEADS_PER_REFILL_ORDER", async () => {
    const res = await POST(postReq({ quantity: 200_000 }));
    expect(res.status).toBe(422);
  });

  test("422 si quantity n'est pas un entier", async () => {
    const res = await POST(postReq({ quantity: 1.5 }));
    expect(res.status).toBe(422);
  });

  test("404 si tenant introuvable (état dégradé)", async () => {
    mocks.tenantFindUnique.mockResolvedValue(null);
    const res = await POST(postReq({ quantity: 500 }));
    expect(res.status).toBe(404);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("tenant_not_found");
  });
});

describe("POST /api/billing/refill-checkout — délégation Hub", () => {
  test("200 + url Stripe quand le Hub répond OK", async () => {
    const res = await POST(postReq({ quantity: 500 }));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      url: string;
      sessionId: string;
      quantity: number;
      refillTier: string;
      expectedCostCents: number;
    };
    expect(body.url).toBe("https://checkout.stripe.com/c/pay/cs_test_xxx");
    expect(body.sessionId).toBe("cs_test_xxx");
    expect(body.quantity).toBe(500);
    expect(body.refillTier).toBe("pro");
    // pro / 500 = 25c × 500 = 12500c
    expect(body.expectedCostCents).toBe(12500);
  });

  test("le Hub reçoit ctx.tenantId, jamais une valeur du body (anti cross-tenant)", async () => {
    await POST(
      postReq({
        quantity: 100,
        // Le client tente d'injecter un autre tenantId — doit être ignoré.
        tenantId: "99999999-9999-4999-8999-999999999999",
      }),
    );
    expect(mocks.createRefillCheckout).toHaveBeenCalledTimes(1);
    const call = mocks.createRefillCheckout.mock.calls[0][0];
    expect(call.tenantId).toBe(TENANT_ID);
    expect(call.quantity).toBe(100);
  });

  test("successUrl + cancelUrl propagés au Hub quand fournis", async () => {
    await POST(
      postReq({
        quantity: 100,
        successUrl: "https://prospection.veridian.site/settings/leads?refill=success",
        cancelUrl: "https://prospection.veridian.site/settings/leads?refill=cancel",
      }),
    );
    const call = mocks.createRefillCheckout.mock.calls[0][0];
    expect(call.successUrl).toBe(
      "https://prospection.veridian.site/settings/leads?refill=success",
    );
    expect(call.cancelUrl).toBe(
      "https://prospection.veridian.site/settings/leads?refill=cancel",
    );
  });

  test("502 si le Hub retourne hub_server_error", async () => {
    mocks.createRefillCheckout.mockResolvedValue({
      ok: false,
      reason: "hub_server_error",
      status: 502,
    });
    const res = await POST(postReq({ quantity: 100 }));
    expect(res.status).toBe(502);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("hub_server_error");
  });

  test("502 si timeout Hub", async () => {
    mocks.createRefillCheckout.mockResolvedValue({
      ok: false,
      reason: "hub_timeout",
    });
    const res = await POST(postReq({ quantity: 100 }));
    expect(res.status).toBe(502);
  });

  test("500 si Hub misconfigured (env manquant)", async () => {
    mocks.createRefillCheckout.mockResolvedValue({
      ok: false,
      reason: "hub_misconfigured",
    });
    const res = await POST(postReq({ quantity: 100 }));
    expect(res.status).toBe(500);
  });

  test("500 si Hub renvoie unauthorized (secret HMAC désynchro)", async () => {
    mocks.createRefillCheckout.mockResolvedValue({
      ok: false,
      reason: "hub_unauthorized",
      status: 401,
    });
    const res = await POST(postReq({ quantity: 100 }));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/billing/refill-checkout — mapping plan → tier refill", () => {
  test("plan=freemium → tier=freemium, 100 leads = 40c × 100 = 4000c", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ plan: "freemium" });
    const res = await POST(postReq({ quantity: 100 }));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { refillTier: string; expectedCostCents: number };
    expect(body.refillTier).toBe("freemium");
    expect(body.expectedCostCents).toBe(4000);
  });

  test("plan=business → tier=business, 1000 leads = 10c × 1000 = 10000c", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ plan: "business" });
    const res = await POST(postReq({ quantity: 1000 }));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { refillTier: string; expectedCostCents: number };
    expect(body.refillTier).toBe("business");
    expect(body.expectedCostCents).toBe(10000);
  });

  test("plan=enterprise → tier=business (Prosp plafonne au business)", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ plan: "enterprise" });
    const res = await POST(postReq({ quantity: 100 }));
    const body = (await readJson(res)) as { refillTier: string };
    expect(body.refillTier).toBe("business");
  });

  test("plan=lifetime_partner → tier=business", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ plan: "lifetime_partner" });
    const res = await POST(postReq({ quantity: 100 }));
    const body = (await readJson(res)) as { refillTier: string };
    expect(body.refillTier).toBe("business");
  });

  test("plan=null/inconnu → tier=freemium (fallback safe)", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ plan: null });
    const res = await POST(postReq({ quantity: 50 }));
    const body = (await readJson(res)) as { refillTier: string };
    expect(body.refillTier).toBe("freemium");
  });
});
