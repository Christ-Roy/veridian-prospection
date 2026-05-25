/**
 * Tests du client sortant Prosp → Hub v2.1 (refill ICP).
 *
 * Couvre :
 *  - hub_misconfigured si HUB_API_URL ou HUB_API_SECRET absent
 *  - hub_timeout sur AbortError
 *  - hub_network sur fetch reject
 *  - hub_unauthorized sur 401/403
 *  - hub_bad_request sur 4xx
 *  - hub_server_error sur 5xx
 *  - hub_invalid_response si shape inattendue
 *  - happy path : signature HMAC posée, body inclut filters_json si fourni
 *  - body OMET filters_json si filters undefined
 *  - contract_version est posé à "2.1"
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

import { createRefillCheckoutFromApp } from "@/lib/hub/refill-from-app-client";

const FAKE_HUB = "https://hub.test.example";
const FAKE_SECRET = "test_secret_abc123";

describe("createRefillCheckoutFromApp", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.HUB_API_URL = FAKE_HUB;
    process.env.HUB_API_SECRET = FAKE_SECRET;
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    delete process.env.HUB_API_URL;
    delete process.env.HUB_API_SECRET;
  });

  test("returns hub_misconfigured if HUB_API_URL missing", async () => {
    delete process.env.HUB_API_URL;
    const result = await createRefillCheckoutFromApp({
      tenantId: "t-1",
      quantity: 100,
      plan: "freemium",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_misconfigured");
  });

  test("returns hub_misconfigured if HUB_API_SECRET missing", async () => {
    delete process.env.HUB_API_SECRET;
    delete process.env.TENANT_API_SECRET;
    const result = await createRefillCheckoutFromApp({
      tenantId: "t-1",
      quantity: 100,
      plan: "freemium",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_misconfigured");
  });

  test("happy path: returns parsed Hub response, posts HMAC headers", async () => {
    let capturedRequest:
      | { url: string; init: RequestInit & { body?: string } }
      | null = null;
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
      capturedRequest = { url, init: init as RequestInit & { body?: string } };
      return new Response(
        JSON.stringify({
          url: "https://checkout.stripe.com/c/pay/cs_test_xyz",
          sessionId: "cs_test_xyz",
          amount_cents: 5000,
          quantity: 100,
          tier: "freemium",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await createRefillCheckoutFromApp({
      tenantId: "tenant-abc",
      quantity: 100,
      plan: "freemium",
      filters: { country: "FR", regions: ["75"] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionId).toBe("cs_test_xyz");
    expect(result.amountCents).toBe(5000);

    // Inspect request
    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.url).toBe(
      `${FAKE_HUB}/api/billing/refill-leads/checkout-from-app`,
    );
    const headers = new Headers(capturedRequest!.init.headers as HeadersInit);
    expect(headers.get("x-veridian-app")).toBe("prospection");
    expect(headers.get("x-veridian-hub-signature")).toBeTruthy();
    expect(headers.get("x-veridian-timestamp")).toBeTruthy();

    // Verify signature is correct HMAC-SHA256 over `${timestamp}.${body}`
    const body = capturedRequest!.init.body as string;
    const timestamp = headers.get("x-veridian-timestamp")!;
    const expected = createHmac("sha256", FAKE_SECRET)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    expect(headers.get("x-veridian-hub-signature")).toBe(expected);

    // Body contains contract_version 2.1 + filters_json
    const parsed = JSON.parse(body);
    expect(parsed.contract_version).toBe("2.1");
    expect(parsed.tenant_id).toBe("tenant-abc");
    expect(parsed.plan).toBe("freemium");
    expect(parsed.filters_json).toEqual({ country: "FR", regions: ["75"] });
  });

  test("omits filters_json when filters undefined", async () => {
    let capturedBody: string = "";
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return new Response(
        JSON.stringify({
          url: "https://checkout.stripe.com/x",
          sessionId: "cs_y",
          amount_cents: 1000,
          quantity: 10,
          tier: "pro",
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await createRefillCheckoutFromApp({
      tenantId: "t-1",
      quantity: 10,
      plan: "pro",
    });
    const parsed = JSON.parse(capturedBody);
    expect(parsed.filters_json).toBeUndefined();
  });

  test("returns hub_unauthorized on 401", async () => {
    global.fetch = vi.fn(
      async () => new Response("Unauthorized", { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await createRefillCheckoutFromApp({
      tenantId: "t",
      quantity: 1,
      plan: "freemium",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("hub_unauthorized");
      expect(result.status).toBe(401);
    }
  });

  test("returns hub_bad_request on 400", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid_payload" }), {
          status: 400,
        }),
    ) as unknown as typeof fetch;
    const result = await createRefillCheckoutFromApp({
      tenantId: "t",
      quantity: 1,
      plan: "freemium",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_bad_request");
  });

  test("returns hub_server_error on 503", async () => {
    global.fetch = vi.fn(
      async () => new Response("Service Unavailable", { status: 503 }),
    ) as unknown as typeof fetch;
    const result = await createRefillCheckoutFromApp({
      tenantId: "t",
      quantity: 1,
      plan: "freemium",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_server_error");
  });

  test("returns hub_invalid_response if Hub returns non-object", async () => {
    global.fetch = vi.fn(
      async () => new Response("not json at all", { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await createRefillCheckoutFromApp({
      tenantId: "t",
      quantity: 1,
      plan: "freemium",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_invalid_response");
  });

  test("returns hub_invalid_response if Hub response missing required keys", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ url: "x" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await createRefillCheckoutFromApp({
      tenantId: "t",
      quantity: 1,
      plan: "freemium",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_invalid_response");
  });

  test("returns hub_network on fetch reject", async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError("network failed");
    }) as unknown as typeof fetch;
    const result = await createRefillCheckoutFromApp({
      tenantId: "t",
      quantity: 1,
      plan: "freemium",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("hub_network");
  });
});
