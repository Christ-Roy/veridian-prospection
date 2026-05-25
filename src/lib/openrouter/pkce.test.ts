/**
 * Unit tests — OAuth PKCE OpenRouter (verifier, challenge, exchange).
 *
 * On mock fetch global pour ne pas taper le vrai endpoint OpenRouter.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCodeForKey,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  OpenRouterPkceError,
} from "./pkce";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => fetchMock.mockReset());

describe("generateCodeVerifier", () => {
  it("retourne une chaîne base64url 43-128 chars (RFC 7636)", () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("génère des valeurs différentes (entropie)", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe("generateCodeChallenge", () => {
  it("retourne SHA256(verifier) en base64url sans padding", () => {
    // Cas connu : verifier = "test" → SHA256 hex = 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
    const c = generateCodeChallenge("test");
    expect(c).toBe("n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg");
    expect(c).not.toContain("=");
  });

  it("même verifier → même challenge (déterministe)", () => {
    const v = generateCodeVerifier();
    expect(generateCodeChallenge(v)).toBe(generateCodeChallenge(v));
  });
});

describe("generateState", () => {
  it("retourne base64url 22-30 chars (16 bytes random)", () => {
    const s = generateState();
    expect(s.length).toBeGreaterThanOrEqual(20);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("buildAuthorizeUrl", () => {
  it("construit l'URL avec tous les params requis", () => {
    const url = buildAuthorizeUrl({
      callbackUrl: "https://prospection.app.veridian.site/api/integrations/openrouter/callback",
      codeChallenge: "abc",
      state: "xyz",
    });
    expect(url).toMatch(/^https:\/\/openrouter\.ai\/auth\?/);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("callback_url")).toBe(
      "https://prospection.app.veridian.site/api/integrations/openrouter/callback",
    );
    expect(parsed.searchParams.get("code_challenge")).toBe("abc");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("xyz");
  });
});

describe("exchangeCodeForKey", () => {
  function ok(body: unknown) {
    return new Response(JSON.stringify(body), { status: 200 });
  }

  it("POST openrouter.ai/api/v1/auth/keys avec code + verifier + method", async () => {
    fetchMock.mockResolvedValueOnce(ok({ key: "sk-or-v1-test-key" }));
    await exchangeCodeForKey({ code: "C", codeVerifier: "V" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.code).toBe("C");
    expect(body.code_verifier).toBe("V");
    expect(body.code_challenge_method).toBe("S256");
  });

  it("retourne { key, userId } sur succès", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ key: "sk-or-v1-abc", user_id: "user_123" }),
    );
    const r = await exchangeCodeForKey({ code: "c", codeVerifier: "v" });
    expect(r.key).toBe("sk-or-v1-abc");
    expect(r.userId).toBe("user_123");
  });

  it("401 → kind=auth", async () => {
    fetchMock.mockResolvedValueOnce(new Response("invalid grant", { status: 401 }));
    const err = await exchangeCodeForKey({ code: "c", codeVerifier: "v" }).catch((e) => e);
    expect(err).toBeInstanceOf(OpenRouterPkceError);
    expect(err.kind).toBe("auth");
    expect(err.statusFromProvider).toBe(401);
  });

  it("503 → kind=server", async () => {
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    const err = await exchangeCodeForKey({ code: "c", codeVerifier: "v" }).catch((e) => e);
    expect(err.kind).toBe("server");
  });

  it("400 (code expiré côté OpenRouter) → kind=invalid", async () => {
    fetchMock.mockResolvedValueOnce(new Response("code expired", { status: 400 }));
    const err = await exchangeCodeForKey({ code: "c", codeVerifier: "v" }).catch((e) => e);
    expect(err.kind).toBe("invalid");
  });

  it("réponse sans key → kind=server (anti-confusion)", async () => {
    fetchMock.mockResolvedValueOnce(ok({ foo: "bar" }));
    const err = await exchangeCodeForKey({ code: "c", codeVerifier: "v" }).catch((e) => e);
    expect(err.kind).toBe("server");
  });

  it("réponse avec key sans prefix sk-or → refuse (anti-confusion provider)", async () => {
    fetchMock.mockResolvedValueOnce(ok({ key: "evil-key-not-from-openrouter" }));
    const err = await exchangeCodeForKey({ code: "c", codeVerifier: "v" }).catch((e) => e);
    expect(err.kind).toBe("server");
  });

  it("fetch rejette → kind=network", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const err = await exchangeCodeForKey({ code: "c", codeVerifier: "v" }).catch((e) => e);
    expect(err.kind).toBe("network");
  });
});
