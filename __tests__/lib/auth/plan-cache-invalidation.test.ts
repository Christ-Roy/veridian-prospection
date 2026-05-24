/**
 * Tests — invalidation du cache plan in-memory (`planCache` dans tenant.ts).
 *
 * Audit trial résidus 2026-05-24 : `getTenantProspectLimit` cache 5min.
 * Avant le fix, un user qui upgrade restait capé jusqu'à 5 min car
 * `update-plan` ne touchait pas le cache. Maintenant
 * `invalidatePlanCacheForTenant(tenantId)` purge toutes les entrées du
 * tenant. Ces tests verrouillent le contrat :
 *
 *  1. invalidate(tenantId) supprime UNIQUEMENT les entrées du tenant donné
 *  2. invalidate(autreTenant) ne touche pas le tenant courant
 *  3. invalidate(inconnu) = no-op (retourne 0)
 *  4. Une entrée sans tenantId (résolution DB échouée) n'est jamais matchée
 *     par une invalidation explicite (préserve le fallback freemium).
 */
import { describe, expect, test, beforeEach } from "vitest";

import {
  invalidatePlanCacheForTenant,
  __planCacheInternals,
} from "@/lib/auth/tenant";

const FUTURE = Date.now() + 60_000;

beforeEach(() => {
  __planCacheInternals.clear();
});

describe("invalidatePlanCacheForTenant", () => {
  test("supprime toutes les entrées d'un tenant donné", () => {
    __planCacheInternals.set("u-1", { limit: 300, tenantId: "t-A", expiresAt: FUTURE });
    __planCacheInternals.set("u-2", { limit: 300, tenantId: "t-A", expiresAt: FUTURE });
    __planCacheInternals.set("u-3", { limit: 100000, tenantId: "t-B", expiresAt: FUTURE });

    const cleared = invalidatePlanCacheForTenant("t-A");

    expect(cleared).toBe(2);
    expect(__planCacheInternals.get("u-1")).toBeUndefined();
    expect(__planCacheInternals.get("u-2")).toBeUndefined();
    expect(__planCacheInternals.get("u-3")).toBeDefined();
  });

  test("ne touche pas un autre tenant", () => {
    __planCacheInternals.set("u-A", { limit: 300, tenantId: "t-A", expiresAt: FUTURE });
    __planCacheInternals.set("u-B", { limit: 100000, tenantId: "t-B", expiresAt: FUTURE });

    invalidatePlanCacheForTenant("t-A");

    const remaining = __planCacheInternals.get("u-B");
    expect(remaining).toBeDefined();
    expect(remaining?.limit).toBe(100000);
    expect(remaining?.tenantId).toBe("t-B");
  });

  test("no-op si tenant inconnu (retourne 0, aucune entrée supprimée)", () => {
    __planCacheInternals.set("u-1", { limit: 300, tenantId: "t-A", expiresAt: FUTURE });

    const cleared = invalidatePlanCacheForTenant("t-inexistant");

    expect(cleared).toBe(0);
    expect(__planCacheInternals.size()).toBe(1);
  });

  test("ignore les entrées sans tenantId (fallback DB-down)", () => {
    // Si la résolution DB a échoué, on a peut-être un fallback freemium
    // stocké sans tenantId — pas matchable par invalidate explicite.
    __planCacheInternals.set("u-fallback", { limit: 300, tenantId: null, expiresAt: FUTURE });
    __planCacheInternals.set("u-A", { limit: 300, tenantId: "t-A", expiresAt: FUTURE });

    const cleared = invalidatePlanCacheForTenant("t-A");

    expect(cleared).toBe(1);
    expect(__planCacheInternals.get("u-fallback")).toBeDefined();
  });

  test("idempotent : 2e appel sur le même tenant retourne 0", () => {
    __planCacheInternals.set("u-1", { limit: 300, tenantId: "t-A", expiresAt: FUTURE });

    expect(invalidatePlanCacheForTenant("t-A")).toBe(1);
    expect(invalidatePlanCacheForTenant("t-A")).toBe(0);
  });
});
