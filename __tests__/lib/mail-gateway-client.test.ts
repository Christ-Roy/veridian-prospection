/**
 * Tests sendMailViaHub — client Prosp → Hub Mail Gateway.
 *
 * Couvre :
 *  - signature HMAC correcte sur `${timestamp}.${body}` (test crypto déterministe)
 *  - mapping des codes erreur Hub → reason canonique (needs_reauth, etc.)
 *  - timeout via AbortController
 *  - hub_misconfigured si URL/secret manquant
 *  - idempotency key déterministe stable
 *  - validation payload (bodyText/bodyHtml requis)
 */
import { describe, expect, test, beforeEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  sendMailViaHub,
  deterministicIdempotencyKey,
  freshIdempotencyKey,
  checkHubMailProviderStatus,
  _clearMailProviderStatusCache,
} from "@/lib/mail-gateway-client";

const HUB_URL = "https://hub.test.veridian.site";
const SECRET = "test-secret-deadbeef-1234567890";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const IDEM_KEY = "22222222-2222-4222-8222-222222222222";

const VALID_PARAMS = {
  userId: USER_ID,
  to: "alice@acme.com",
  subject: "Hello Alice",
  bodyText: "Hi Alice",
  bodyHtml: "<p>Hi Alice</p>",
  idempotencyKey: IDEM_KEY,
};

function mockFetchSuccess() {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl: typeof fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        message_id: "<msg-1@gmail.com>",
        provider_used: "google",
        sent_at: "2026-05-25T12:34:56.000Z",
        idempotent_replay: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return { impl, calls };
}

function mockFetchError(status: number, errorCode: string) {
  return vi.fn(async () => {
    return new Response(
      JSON.stringify({ error: errorCode }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
}

describe("sendMailViaHub", () => {
  beforeEach(() => {
    delete process.env.HUB_API_URL;
    delete process.env.PROSPECTION_HUB_API_SECRET;
    delete process.env.HUB_API_SECRET;
  });

  test("hub_misconfigured si URL absent", async () => {
    const result = await sendMailViaHub(VALID_PARAMS, { secret: SECRET });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("hub_misconfigured");
  });

  test("hub_misconfigured si secret absent", async () => {
    const result = await sendMailViaHub(VALID_PARAMS, { hubUrl: HUB_URL });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("hub_misconfigured");
  });

  test("invalid_payload si ni bodyText ni bodyHtml", async () => {
    const { impl } = mockFetchSuccess();
    const result = await sendMailViaHub(
      { ...VALID_PARAMS, bodyText: undefined, bodyHtml: undefined },
      { hubUrl: HUB_URL, secret: SECRET, fetchImpl: impl },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("invalid_payload");
  });

  test("happy path : signature HMAC correcte + headers + body JSON", async () => {
    const { impl, calls } = mockFetchSuccess();
    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: impl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("must succeed");
    expect(result.messageId).toBe("<msg-1@gmail.com>");
    expect(result.idempotentReplay).toBe(false);
    expect(result.sentAt.toISOString()).toBe("2026-05-25T12:34:56.000Z");

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe(`${HUB_URL}/api/mail/send-as-user`);
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-veridian-app"]).toBe("prospection");
    expect(headers["x-veridian-timestamp"]).toMatch(/^\d{13}$/);
    expect(headers["x-veridian-hub-signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(headers["Content-Type"]).toBe("application/json");

    // Recompute HMAC pour vérifier la signature
    const ts = headers["x-veridian-timestamp"];
    const body = call.init.body as string;
    const expected = createHmac("sha256", SECRET)
      .update(`${ts}.${body}`)
      .digest("hex");
    expect(headers["x-veridian-hub-signature"]).toBe(expected);

    // Body bien sérialisé
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({
      user_id: USER_ID,
      to: "alice@acme.com",
      subject: "Hello Alice",
      body_text: "Hi Alice",
      body_html: "<p>Hi Alice</p>",
      idempotency_key: IDEM_KEY,
      contract_version: "1.0",
    });
  });

  test("idempotent_replay = true si Hub retourne true", async () => {
    const impl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          message_id: "<msg-replay@gmail.com>",
          sent_at: "2026-05-25T12:00:00.000Z",
          idempotent_replay: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: impl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("must succeed");
    expect(result.idempotentReplay).toBe(true);
  });

  test("mapping 401 invalid_hmac → reason invalid_hmac", async () => {
    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: mockFetchError(401, "invalid_hmac"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("invalid_hmac");
    expect(result.httpStatus).toBe(401);
  });

  test("mapping 412 needs_reauth → reason needs_reauth", async () => {
    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: mockFetchError(412, "needs_reauth"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("needs_reauth");
    expect(result.httpStatus).toBe(412);
  });

  test("mapping 422 provider_not_linked → reason provider_not_linked", async () => {
    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: mockFetchError(422, "provider_not_linked"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("provider_not_linked");
    expect(result.httpStatus).toBe(422);
  });

  test("mapping 404 user_not_found → reason user_not_found", async () => {
    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: mockFetchError(404, "user_not_found"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("user_not_found");
  });

  test("mapping 429 rate_limit → reason rate_limit", async () => {
    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: mockFetchError(429, "rate_limit"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("rate_limit");
  });

  test("mapping 503 provider_unreachable → reason provider_unreachable", async () => {
    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: mockFetchError(503, "provider_unreachable"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("provider_unreachable");
  });

  test("hub_invalid_response si JSON malformé", async () => {
    const impl = vi.fn(async () => {
      return new Response("not json", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: impl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("hub_invalid_response");
  });

  test("hub_invalid_response si message_id manquant dans réponse 200", async () => {
    const impl = vi.fn(async () => {
      return new Response(JSON.stringify({ sent_at: "2026-05-25T12:00:00Z" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: impl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("hub_invalid_response");
  });

  test("hub_timeout si abort déclenché", async () => {
    const impl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      // Simule le respect du signal — wait puis check aborted
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    }) as unknown as typeof fetch;

    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: impl,
      timeoutMs: 10,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("hub_timeout");
  });

  test("hub_network si fetch throw", async () => {
    const impl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await sendMailViaHub(VALID_PARAMS, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl: impl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("must fail");
    expect(result.reason).toBe("hub_network");
  });

  test("lit PROSPECTION_HUB_API_SECRET en priorité sur HUB_API_SECRET", async () => {
    process.env.HUB_API_URL = HUB_URL;
    process.env.PROSPECTION_HUB_API_SECRET = "prospection-specific";
    process.env.HUB_API_SECRET = "generic";

    const { impl, calls } = mockFetchSuccess();
    await sendMailViaHub(VALID_PARAMS, { fetchImpl: impl });
    expect(calls).toHaveLength(1);
    const headers = calls[0].init.headers as Record<string, string>;
    const ts = headers["x-veridian-timestamp"];
    const body = calls[0].init.body as string;
    const expected = createHmac("sha256", "prospection-specific")
      .update(`${ts}.${body}`)
      .digest("hex");
    expect(headers["x-veridian-hub-signature"]).toBe(expected);
  });

  test("fallback HUB_API_SECRET si PROSPECTION_HUB_API_SECRET absent", async () => {
    process.env.HUB_API_URL = HUB_URL;
    process.env.HUB_API_SECRET = "fallback-secret";

    const { impl, calls } = mockFetchSuccess();
    const result = await sendMailViaHub(VALID_PARAMS, { fetchImpl: impl });
    expect(result.ok).toBe(true);
    const headers = calls[0].init.headers as Record<string, string>;
    const ts = headers["x-veridian-timestamp"];
    const body = calls[0].init.body as string;
    const expected = createHmac("sha256", "fallback-secret")
      .update(`${ts}.${body}`)
      .digest("hex");
    expect(headers["x-veridian-hub-signature"]).toBe(expected);
  });
});

describe("deterministicIdempotencyKey", () => {
  test("stable pour mêmes inputs", () => {
    const k1 = deterministicIdempotencyKey("camp-1", "alice@acme.com", 0);
    const k2 = deterministicIdempotencyKey("camp-1", "alice@acme.com", 0);
    expect(k1).toBe(k2);
  });

  test("différent pour campagne différente", () => {
    const k1 = deterministicIdempotencyKey("camp-1", "alice@acme.com", 0);
    const k2 = deterministicIdempotencyKey("camp-2", "alice@acme.com", 0);
    expect(k1).not.toBe(k2);
  });

  test("différent pour step différent", () => {
    const k1 = deterministicIdempotencyKey("camp-1", "alice@acme.com", 0);
    const k2 = deterministicIdempotencyKey("camp-1", "alice@acme.com", 1);
    expect(k1).not.toBe(k2);
  });

  test("case-insensitive sur email", () => {
    const k1 = deterministicIdempotencyKey("camp-1", "Alice@Acme.COM", 0);
    const k2 = deterministicIdempotencyKey("camp-1", "alice@acme.com", 0);
    expect(k1).toBe(k2);
  });

  test("format UUID v4 valide", () => {
    const k = deterministicIdempotencyKey("camp-1", "alice@acme.com", 0);
    expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("freshIdempotencyKey", () => {
  test("génère un UUID v4", () => {
    const k = freshIdempotencyKey();
    expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("génère des keys uniques", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) keys.add(freshIdempotencyKey());
    expect(keys.size).toBe(100);
  });
});

describe("checkHubMailProviderStatus", () => {
  beforeEach(() => {
    _clearMailProviderStatusCache();
  });

  test("linked=true si Hub répond provider != none && !needs_reauth", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ provider: "google", needs_reauth: false }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const linked = await checkHubMailProviderStatus(USER_ID, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl,
    });
    expect(linked).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("linked=false si Hub répond provider === none", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ provider: "none", needs_reauth: false }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const linked = await checkHubMailProviderStatus(USER_ID, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl,
    });
    expect(linked).toBe(false);
  });

  test("linked=false si needs_reauth=true (token Google révoqué)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ provider: "google", needs_reauth: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const linked = await checkHubMailProviderStatus(USER_ID, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl,
    });
    expect(linked).toBe(false);
  });

  test("linked=false sur Hub down (network error) — best-effort strict", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const linked = await checkHubMailProviderStatus(USER_ID, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl,
    });
    expect(linked).toBe(false);
  });

  test("linked=false sur Hub 5xx", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("Internal", { status: 500 }),
    ) as unknown as typeof fetch;

    const linked = await checkHubMailProviderStatus(USER_ID, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl,
    });
    expect(linked).toBe(false);
  });

  test("linked=false si URL ou secret absent", async () => {
    const linked = await checkHubMailProviderStatus(USER_ID, {});
    expect(linked).toBe(false);
  });

  test("cache 5 min : second call ne refait pas le HMAC roundtrip", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ provider: "google", needs_reauth: false }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const linked1 = await checkHubMailProviderStatus(USER_ID, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl,
    });
    const linked2 = await checkHubMailProviderStatus(USER_ID, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl,
    });
    expect(linked1).toBe(true);
    expect(linked2).toBe(true);
    // Second appel servi par cache → fetch appelé une seule fois.
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  test("skipCache=true bypass le cache (utile aux tests)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ provider: "google", needs_reauth: false }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    await checkHubMailProviderStatus(USER_ID, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl,
    });
    await checkHubMailProviderStatus(USER_ID, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl,
      skipCache: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("HMAC signature présente dans les headers + timestamp en header", async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({ provider: "google", needs_reauth: false }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await checkHubMailProviderStatus(USER_ID, {
      hubUrl: HUB_URL,
      secret: SECRET,
      fetchImpl,
    });

    const h = capturedHeaders as Record<string, string>;
    expect(h["x-veridian-app"]).toBe("prospection");
    expect(h["x-veridian-timestamp"]).toMatch(/^\d+$/);
    expect(h["x-veridian-hub-signature"]).toMatch(/^[0-9a-f]+$/);

    // Re-compute signature : `${ts}.` sans body (GET).
    const ts = h["x-veridian-timestamp"]!;
    const expectedSig = createHmac("sha256", SECRET)
      .update(`${ts}.`)
      .digest("hex");
    expect(h["x-veridian-hub-signature"]).toBe(expectedSig);
  });
});
