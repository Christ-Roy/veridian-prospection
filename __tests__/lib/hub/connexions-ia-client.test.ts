/**
 * Client Hub `connexions-ia` : signature HMAC §6.1 sur `${ts}.`, réponse relue sans confiance, toute
 * panne rend null (jamais d'exception), cache de 60 s par compte.
 */
import { createHmac } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { connexionsIaHub, viderCacheConnexionsIa } from "@/lib/hub/connexions-ia-client";

const ENV = { TENANT_API_SECRET: "s3cret", NEXT_PUBLIC_HUB_URL: "https://hub.test/" } as unknown as NodeJS.ProcessEnv;
const T = 1_800_000_000_000;

beforeEach(() => viderCacheConnexionsIa());

describe("connexionsIaHub", () => {
  test("signe ts. avec le secret, lit les connexions, ignore les entrées sans nom, met en cache 60 s", async () => {
    const appels: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      appels.push({ url, init });
      return new Response(JSON.stringify({ hub_user_id: "h-1", connexions: [{ client: "Claude", depuis: "2026-11-09T21:21:00Z", derniere_utilisation: null }, { client: "" }, { depuis: "x" }] }));
    }) as unknown as typeof fetch;
    const r = await connexionsIaHub("h-1", { env: ENV, fetchImpl, maintenant: T });
    expect(r).toEqual([{ nom: "Claude", depuis: "2026-11-09T21:21:00Z", derniere_utilisation: null }]);
    expect(appels[0].url).toBe("https://hub.test/api/hub/connexions-ia?hub_user_id=h-1");
    const h = appels[0].init.headers as Record<string, string>;
    expect(h["X-Veridian-Timestamp"]).toBe(String(T));
    expect(h["X-Veridian-Hub-Signature"]).toBe(createHmac("sha256", "s3cret").update(`${T}.`).digest("hex"));
    await connexionsIaHub("h-1", { env: ENV, fetchImpl, maintenant: T + 30_000 });
    expect(appels).toHaveLength(1);
    await connexionsIaHub("h-1", { env: ENV, fetchImpl, maintenant: T + 61_000 });
    expect(appels).toHaveLength(2);
  });

  test("refus, panne réseau, secret ou compte absent : null, sans exception", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const refus = (async () => new Response("non", { status: 401 })) as unknown as typeof fetch;
    expect(await connexionsIaHub("h-1", { env: ENV, fetchImpl: refus, maintenant: T })).toBeNull();
    const panne = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await connexionsIaHub("h-2", { env: ENV, fetchImpl: panne, maintenant: T })).toBeNull();
    expect(await connexionsIaHub("h-3", { env: {} as NodeJS.ProcessEnv, fetchImpl: panne })).toBeNull();
    expect(await connexionsIaHub(null, { env: ENV, fetchImpl: panne })).toBeNull();
  });
});
