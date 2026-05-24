/**
 * Tests pour les helpers de tenant — getTenantProspectLimit + isGiftedPlan.
 *
 * Couvre la matrice PLAN_LIMITS du CONTRAT-HUB.md §3.3 :
 *  - freemium / starter / pro / enterprise → caps numériques
 *  - lifetime_site_vitrine / lifetime_partner / internal → Infinity
 *  - plan inconnu → fallback freemium
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { queryRawUnsafe } = vi.hoisted(() => ({ queryRawUnsafe: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRawUnsafe: queryRawUnsafe },
}));

import {
  getTenantProspectLimit,
  isGiftedPlan,
  GIFTED_PLANS,
  invalidatePlanCacheForTenant,
  __planCacheInternals,
} from "@/lib/auth/tenant";

describe("isGiftedPlan", () => {
  test("retourne true pour lifetime_site_vitrine", () => {
    expect(isGiftedPlan("lifetime_site_vitrine")).toBe(true);
  });
  test("retourne true pour lifetime_partner", () => {
    expect(isGiftedPlan("lifetime_partner")).toBe(true);
  });
  test("retourne true pour internal", () => {
    expect(isGiftedPlan("internal")).toBe(true);
  });
  test("retourne false pour freemium", () => {
    expect(isGiftedPlan("freemium")).toBe(false);
  });
  test("retourne false pour pro / enterprise / starter", () => {
    expect(isGiftedPlan("pro")).toBe(false);
    expect(isGiftedPlan("enterprise")).toBe(false);
    expect(isGiftedPlan("starter")).toBe(false);
  });
  test("retourne false pour null / undefined / vide / autre", () => {
    expect(isGiftedPlan(null)).toBe(false);
    expect(isGiftedPlan(undefined)).toBe(false);
    expect(isGiftedPlan("")).toBe(false);
    expect(isGiftedPlan("ultra-mega")).toBe(false);
  });
});

describe("GIFTED_PLANS export", () => {
  test("contient exactement les 3 plans offerts du contrat §3.3", () => {
    expect([...GIFTED_PLANS]).toEqual([
      "lifetime_site_vitrine",
      "lifetime_partner",
      "internal",
    ]);
  });
});

describe("getTenantProspectLimit", () => {
  beforeEach(() => {
    queryRawUnsafe.mockReset();
  });

  test("freemium → 300 (env default)", async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ plan: "freemium" }]);
    const limit = await getTenantProspectLimit(`u-free-${Math.random()}`);
    expect(limit).toBe(300);
  });

  test("pro → 100000", async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ plan: "pro" }]);
    const limit = await getTenantProspectLimit(`u-pro-${Math.random()}`);
    expect(limit).toBe(100000);
  });

  test("enterprise → 500000", async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ plan: "enterprise" }]);
    const limit = await getTenantProspectLimit(`u-ent-${Math.random()}`);
    expect(limit).toBe(500000);
  });

  test("starter → 5000", async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ plan: "starter" }]);
    const limit = await getTenantProspectLimit(`u-starter-${Math.random()}`);
    expect(limit).toBe(5000);
  });

  test("lifetime_site_vitrine → Infinity", async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ plan: "lifetime_site_vitrine" }]);
    const limit = await getTenantProspectLimit(`u-lsv-${Math.random()}`);
    expect(limit).toBe(Number.POSITIVE_INFINITY);
  });

  test("lifetime_partner → Infinity", async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ plan: "lifetime_partner" }]);
    const limit = await getTenantProspectLimit(`u-lp-${Math.random()}`);
    expect(limit).toBe(Number.POSITIVE_INFINITY);
  });

  test("internal → Infinity", async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ plan: "internal" }]);
    const limit = await getTenantProspectLimit(`u-int-${Math.random()}`);
    expect(limit).toBe(Number.POSITIVE_INFINITY);
  });

  test("plan inconnu → fallback freemium (300)", async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ plan: "ultra-mega-unknown" }]);
    const limit = await getTenantProspectLimit(`u-unk-${Math.random()}`);
    expect(limit).toBe(300);
  });

  test("raw query échoue → fallback freemium (300)", async () => {
    queryRawUnsafe.mockRejectedValueOnce(new Error("db down"));
    const limit = await getTenantProspectLimit(`u-err-${Math.random()}`);
    expect(limit).toBe(300);
  });

  /**
   * Anti-régression Sprint C — la colonne legacy `prospection_plan` est
   * droppée par la migration 0014. Toute lecture par ce nom retournerait
   * silencieusement freemium (catch dans la fonction) et casserait le
   * quota Pro de tous les tenants. Ce test bloque le retour à
   * `prospection_plan` dans la query.
   */
  test("query SQL utilise tenant.plan (pas la colonne legacy prospection_plan)", async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ plan: "pro" }]);
    await getTenantProspectLimit(`u-sql-check-${Math.random()}`);
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toMatch(/SELECT\s+t\.plan/i);
    expect(sql).not.toMatch(/prospection_plan/i);
  });

  // Anti-régression audit trial résidus 2026-05-24 : la SQL doit remonter
  // `tenant.id` pour permettre l'invalidation par tenant après update-plan.
  test("query SQL SELECT tenant.id (pour invalidation par tenant)", async () => {
    queryRawUnsafe.mockResolvedValueOnce([
      { plan: "pro", tenant_id: "t-id-1" },
    ]);
    await getTenantProspectLimit(`u-tenant-id-${Math.random()}`);
    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toMatch(/t\.id/);
  });
});

/**
 * Audit trial résidus 2026-05-24 — invalidation explicite du cache plan
 * par `invalidatePlanCacheForTenant`. Sans ça, un user qui upgrade reste
 * capé jusqu'à 5 min (TTL planCache). Promesse Robert "client paie =
 * aucun cap immédiatement".
 */
describe("invalidatePlanCacheForTenant (audit trial résidus 2026-05-24)", () => {
  const FUTURE = Date.now() + 60_000;

  beforeEach(() => {
    __planCacheInternals.clear();
  });

  test("supprime toutes les entrées d'un tenant donné", () => {
    __planCacheInternals.set("u-1", {
      limit: 300,
      tenantId: "t-A",
      expiresAt: FUTURE,
    });
    __planCacheInternals.set("u-2", {
      limit: 300,
      tenantId: "t-A",
      expiresAt: FUTURE,
    });
    __planCacheInternals.set("u-3", {
      limit: 100000,
      tenantId: "t-B",
      expiresAt: FUTURE,
    });

    const cleared = invalidatePlanCacheForTenant("t-A");

    expect(cleared).toBe(2);
    expect(__planCacheInternals.get("u-1")).toBeUndefined();
    expect(__planCacheInternals.get("u-2")).toBeUndefined();
    expect(__planCacheInternals.get("u-3")).toBeDefined();
  });

  test("ne touche pas les entrées d'autres tenants", () => {
    __planCacheInternals.set("u-A", {
      limit: 300,
      tenantId: "t-A",
      expiresAt: FUTURE,
    });
    __planCacheInternals.set("u-B", {
      limit: 100000,
      tenantId: "t-B",
      expiresAt: FUTURE,
    });

    invalidatePlanCacheForTenant("t-A");

    const remaining = __planCacheInternals.get("u-B");
    expect(remaining).toBeDefined();
    expect(remaining?.limit).toBe(100000);
  });

  test("no-op si tenant inconnu (retourne 0)", () => {
    __planCacheInternals.set("u-1", {
      limit: 300,
      tenantId: "t-A",
      expiresAt: FUTURE,
    });
    expect(invalidatePlanCacheForTenant("t-inexistant")).toBe(0);
    expect(__planCacheInternals.size()).toBe(1);
  });

  test("ignore les entrées sans tenantId (fallback DB-down inviolé)", () => {
    __planCacheInternals.set("u-fallback", {
      limit: 300,
      tenantId: null,
      expiresAt: FUTURE,
    });
    __planCacheInternals.set("u-A", {
      limit: 300,
      tenantId: "t-A",
      expiresAt: FUTURE,
    });

    expect(invalidatePlanCacheForTenant("t-A")).toBe(1);
    expect(__planCacheInternals.get("u-fallback")).toBeDefined();
  });

  test("idempotent — 2e appel sur le même tenant retourne 0", () => {
    __planCacheInternals.set("u-1", {
      limit: 300,
      tenantId: "t-A",
      expiresAt: FUTURE,
    });
    expect(invalidatePlanCacheForTenant("t-A")).toBe(1);
    expect(invalidatePlanCacheForTenant("t-A")).toBe(0);
  });
});
