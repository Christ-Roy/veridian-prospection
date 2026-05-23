/**
 * Tests unitaires src/lib/hub/discovery-client.ts.
 *
 * Run : npx vitest run __tests__/lib/hub/discovery-client.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "crypto";

import { fetchHubDiscovery } from "@/lib/hub/discovery-client";

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  process.env.HUB_API_URL = "https://hub.example.test";
  process.env.HUB_API_SECRET = "test-secret-aaaa";
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.restoreAllMocks();
});

describe("fetchHubDiscovery — env manquante", () => {
  it("retourne null si HUB_API_URL absent", async () => {
    delete process.env.HUB_API_URL;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await fetchHubDiscovery("alice@example.com");
    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retourne null si HUB_API_SECRET absent", async () => {
    delete process.env.HUB_API_SECRET;
    delete process.env.TENANT_API_SECRET;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await fetchHubDiscovery("alice@example.com");
    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retourne null si l'email est vide/whitespace", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await fetchHubDiscovery("   ");
    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchHubDiscovery — appel HTTP", () => {
  it("envoie email normalisé (lowercase + trim) + signature HMAC `${ts}.`", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      captured = { url: String(url), init: init! };
      return new Response(JSON.stringify({ found: false }), { status: 200 });
    });

    await fetchHubDiscovery("  Alice@Example.COM  ");

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe(
      "https://hub.example.test/api/users/by-email?email=alice%40example.com",
    );

    const headers = captured!.init.headers as Record<string, string>;
    expect(headers["x-veridian-app"]).toBe("prospection");
    const ts = Number(headers["x-veridian-timestamp"]);
    expect(Number.isFinite(ts)).toBe(true);

    const expectedSig = createHmac("sha256", "test-secret-aaaa")
      .update(`${ts}.`)
      .digest("hex");
    expect(headers["x-veridian-hub-signature"]).toBe(expectedSig);
  });

  it("parse une réponse found=true avec workspaces", async () => {
    const payload = {
      found: true,
      user_email: "alice@example.com",
      workspaces: [
        {
          workspace_id: "ws-1",
          workspace_name: "Acme",
          role: "owner",
          plan: "pro",
          status: "active",
          magic_link_capable: true,
          fallback_url: "https://prospection.app.veridian.site/login",
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );

    const res = await fetchHubDiscovery("alice@example.com");
    expect(res).toEqual(payload);
  });

  it("parse une réponse found=false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ found: false }), { status: 200 }),
    );

    const res = await fetchHubDiscovery("bob@example.com");
    expect(res).toEqual({ found: false });
  });
});

describe("fetchHubDiscovery — erreurs best-effort", () => {
  it("retourne null sur 401 (HMAC invalide)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
      }),
    );
    const res = await fetchHubDiscovery("alice@example.com");
    expect(res).toBeNull();
  });

  it("retourne null sur 503 (secret pas configuré Hub)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 503 }),
    );
    const res = await fetchHubDiscovery("alice@example.com");
    expect(res).toBeNull();
  });

  it("retourne null sur erreur réseau", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await fetchHubDiscovery("alice@example.com");
    expect(res).toBeNull();
  });

  it("retourne null sur JSON malformé", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not-json", { status: 200 }),
    );
    const res = await fetchHubDiscovery("alice@example.com");
    expect(res).toBeNull();
  });

  it("retourne null sur réponse 200 avec shape inattendue", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ weird: "shape" }), { status: 200 }),
    );
    const res = await fetchHubDiscovery("alice@example.com");
    expect(res).toBeNull();
  });

  it("respecte le timeout (AbortController)", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    const promise = fetchHubDiscovery("alice@example.com", { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(150);
    const res = await promise;
    expect(res).toBeNull();
    vi.useRealTimers();
  });
});
