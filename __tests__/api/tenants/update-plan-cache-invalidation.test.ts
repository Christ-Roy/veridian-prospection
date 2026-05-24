/**
 * Test anti-régression — `POST /api/tenants/update-plan` invalide le cache
 * `planCache` du tenant.
 *
 * Audit trial résidus 2026-05-24. Sans ce fix, un user qui upgrade restait
 * capé jusqu'à 5 min (TTL planCache). On vérifie ici qu'après un appel
 * update-plan réussi, toutes les entrées du tenant ont disparu du cache.
 *
 * Ce test est séparé du fichier `update-plan.test.ts` historique pour éviter
 * d'enchevêtrer les mocks Prisma (qui ne couvrent pas le path `tenant.ts`
 * réel) avec la branche cache (qui s'appuie sur l'implém réelle de
 * `invalidatePlanCacheForTenant`).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac, randomUUID } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-update-plan-cache-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique, update: mocks.tenantUpdate },
  },
}));

import { POST } from "@/app/api/tenants/update-plan/route";
import { __planCacheInternals } from "@/lib/auth/tenant";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-update-plan-cache-secret";
const FUTURE = Date.now() + 5 * 60_000;

function v2Body(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: "2.0",
    tenant_id: "t-cache-1",
    plan: "pro",
    plan_source: "stripe",
    effective_at: new Date().toISOString(),
    stripe_subscription_id: "sub_cache",
    idempotency_key: randomUUID(),
    reason: "test cache invalidation",
    ...overrides,
  };
}

function signedRequest(body: object) {
  const raw = JSON.stringify(body);
  const ts = Date.now();
  const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  return makeRequest("/api/tenants/update-plan", {
    method: "POST",
    headers: {
      "x-veridian-timestamp": String(ts),
      "x-veridian-hub-signature": sig,
    },
    body: raw,
  });
}

describe("POST /api/tenants/update-plan — invalidation planCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __planCacheInternals.clear();
  });

  test("update-plan réussi purge les entrées planCache du tenant", async () => {
    // 2 users sur le tenant cible (cache poisonné à freemium) + 1 user
    // sur un autre tenant (ne doit PAS être touché).
    __planCacheInternals.set("u-a", {
      limit: 300,
      tenantId: "t-cache-1",
      expiresAt: FUTURE,
    });
    __planCacheInternals.set("u-b", {
      limit: 300,
      tenantId: "t-cache-1",
      expiresAt: FUTURE,
    });
    __planCacheInternals.set("u-other", {
      limit: 300,
      tenantId: "t-cache-2",
      expiresAt: FUTURE,
    });

    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-cache-1",
      plan: "freemium",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});

    const res = await POST(signedRequest(v2Body({ tenant_id: "t-cache-1" })));
    expect(res.status).toBe(200);

    // Les 2 entrées du tenant doivent avoir disparu.
    expect(__planCacheInternals.get("u-a")).toBeUndefined();
    expect(__planCacheInternals.get("u-b")).toBeUndefined();
    // L'entrée d'un autre tenant reste intacte.
    expect(__planCacheInternals.get("u-other")).toBeDefined();
  });

  test("update-plan sans entrée cache existante = no-op (200 OK)", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-cache-empty",
      plan: "freemium",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});

    const res = await POST(
      signedRequest(v2Body({ tenant_id: "t-cache-empty" })),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { plan: string };
    expect(body.plan).toBe("pro");
  });
});
