/**
 * Tests Prospection → Hub `POST /api/billing/refill-leads/checkout`.
 *
 * Couvre :
 *  - hub_misconfigured si HUB_API_URL ou HUB_API_SECRET manquants
 *  - signature HMAC : `${ts}.${rawBody}` sha256 hex (vérif côté caller)
 *  - headers x-veridian-timestamp + x-veridian-hub-signature présents
 *  - 200 + parsing { url, sessionId }
 *  - 401/403 → hub_unauthorized
 *  - 5xx → hub_server_error
 *  - timeout → hub_timeout
 *  - réponse JSON invalide → hub_invalid_response
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

import {
  createRefillCheckout,
} from "@/lib/hub/refill-client";

const ORIG_URL = process.env.HUB_API_URL;
const ORIG_SECRET = process.env.HUB_API_SECRET;
const ORIG_LEGACY = process.env.TENANT_API_SECRET;

beforeEach(() => {
  process.env.HUB_API_URL = "https://hub.test";
  process.env.HUB_API_SECRET = "secret-test-1234";
  delete process.env.TENANT_API_SECRET;
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env.HUB_API_URL = ORIG_URL;
  process.env.HUB_API_SECRET = ORIG_SECRET;
  if (ORIG_LEGACY !== undefined) process.env.TENANT_API_SECRET = ORIG_LEGACY;
});

describe("createRefillCheckout — env guards", () => {
  test("hub_misconfigured si HUB_API_URL absent", async () => {
    delete process.env.HUB_API_URL;
    const result = await createRefillCheckout({
      tenantId: "t-1",
      quantity: 100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_misconfigured");
  });

  test("hub_misconfigured si HUB_API_SECRET absent", async () => {
    delete process.env.HUB_API_SECRET;
    delete process.env.TENANT_API_SECRET;
    const result = await createRefillCheckout({
      tenantId: "t-1",
      quantity: 100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_misconfigured");
  });

  test("TENANT_API_SECRET utilisé en fallback de HUB_API_SECRET", async () => {
    delete process.env.HUB_API_SECRET;
    process.env.TENANT_API_SECRET = "legacy-secret";

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ url: "https://stripe/x", sessionId: "cs_x" }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRefillCheckout({
      tenantId: "t-1",
      quantity: 100,
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createRefillCheckout — succès", () => {
  test("200 + parse { url, sessionId }", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_test", sessionId: "cs_test" }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRefillCheckout({
      tenantId: "tenant-1",
      quantity: 500,
      successUrl: "https://app/success",
      cancelUrl: "https://app/cancel",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://checkout.stripe.com/c/pay/cs_test");
      expect(result.sessionId).toBe("cs_test");
    }

    // URL appelée
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "https://hub.test/api/billing/refill-leads/checkout",
    );

    // Method + content-type
    expect(calledInit.method).toBe("POST");
    expect(calledInit.headers["Content-Type"]).toBe("application/json");
    expect(calledInit.headers["x-veridian-app"]).toBe("prospection");

    // Body contient bien quantity + tenantId + urls
    const sentBody = JSON.parse(calledInit.body as string);
    expect(sentBody.tenantId).toBe("tenant-1");
    expect(sentBody.quantity).toBe(500);
    expect(sentBody.successUrl).toBe("https://app/success");
    expect(sentBody.cancelUrl).toBe("https://app/cancel");

    // Headers HMAC présents + signature vérifiable
    const ts = calledInit.headers["x-veridian-timestamp"];
    const sig = calledInit.headers["x-veridian-hub-signature"];
    expect(typeof ts).toBe("string");
    expect(typeof sig).toBe("string");

    const expectedSig = createHmac("sha256", "secret-test-1234")
      .update(`${ts}.${calledInit.body}`)
      .digest("hex");
    expect(sig).toBe(expectedSig);
  });

  test("successUrl/cancelUrl optionnels (omis du body si absents)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ url: "https://s", sessionId: "cs" }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    await createRefillCheckout({ tenantId: "t-1", quantity: 50 });
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.successUrl).toBeUndefined();
    expect(sentBody.cancelUrl).toBeUndefined();
  });
});

describe("createRefillCheckout — erreurs upstream", () => {
  test("401 → hub_unauthorized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        json: async () => null,
        text: async () => "unauthorized",
      }),
    );
    const result = await createRefillCheckout({ tenantId: "t", quantity: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("hub_unauthorized");
      expect(result.status).toBe(401);
    }
  });

  test("400 → hub_bad_request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 400,
        ok: false,
        json: async () => null,
        text: async () => "invalid quantity",
      }),
    );
    const result = await createRefillCheckout({ tenantId: "t", quantity: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_bad_request");
  });

  test("502 → hub_server_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 502,
        ok: false,
        json: async () => null,
        text: async () => "",
      }),
    );
    const result = await createRefillCheckout({ tenantId: "t", quantity: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_server_error");
  });

  test("réponse JSON sans url/sessionId → hub_invalid_response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ foo: "bar" }),
        text: async () => "",
      }),
    );
    const result = await createRefillCheckout({ tenantId: "t", quantity: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_invalid_response");
  });

  test("AbortError → hub_timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    );
    const result = await createRefillCheckout({ tenantId: "t", quantity: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_timeout");
  });

  test("erreur réseau → hub_network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );
    const result = await createRefillCheckout({ tenantId: "t", quantity: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_network");
  });
});
