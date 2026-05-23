/**
 * Tests unitaires pour src/lib/cache.ts
 *
 * Cache mémoire process-local utilisé pour memoize les résolutions multi-tenant
 * (user-context, plan, etc.). Hot path — toute régression = surcharge DB.
 *
 * Run: npx vitest run src/lib/cache.test.ts
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { cached, invalidate, invalidatePrefix } from "./cache";

beforeEach(() => {
  // Le cache est module-level — on le purge entre chaque test via les
  // helpers publics pour ne pas leak d'état.
  invalidatePrefix("");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cached() — variante synchrone", () => {
  it("appelle fn une seule fois tant que le TTL n'est pas expiré", () => {
    const fn = vi.fn().mockReturnValue("v1");

    expect(cached("k", 1000, fn)).toBe("v1");
    expect(cached("k", 1000, fn)).toBe("v1");
    expect(cached("k", 1000, fn)).toBe("v1");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ré-appelle fn quand le TTL est expiré", () => {
    const fn = vi.fn().mockReturnValueOnce("v1").mockReturnValueOnce("v2");

    expect(cached("k", 1000, fn)).toBe("v1");
    vi.advanceTimersByTime(1001);
    expect(cached("k", 1000, fn)).toBe("v2");

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("isole les valeurs par clé", () => {
    cached("a", 1000, () => "valA");
    cached("b", 1000, () => "valB");

    expect(cached("a", 1000, () => "fallback-a")).toBe("valA");
    expect(cached("b", 1000, () => "fallback-b")).toBe("valB");
  });
});

describe("cached() — variante async", () => {
  it("résout la promise et met en cache la valeur résolue", async () => {
    const fn = vi.fn().mockResolvedValue("async-v1");

    const v1 = await cached("k-async", 1000, fn);
    const v2 = await cached("k-async", 1000, fn);

    expect(v1).toBe("async-v1");
    expect(v2).toBe("async-v1");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ré-appelle fn async après expiration du TTL", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce("async-v1")
      .mockResolvedValueOnce("async-v2");

    expect(await cached("k-async2", 500, fn)).toBe("async-v1");
    vi.advanceTimersByTime(501);
    expect(await cached("k-async2", 500, fn)).toBe("async-v2");

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("ne met PAS en cache une promise rejetée (re-tente au prochain appel)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");

    await expect(cached("k-rej", 1000, fn)).rejects.toThrow("boom");
    // Comportement attendu : un échec ne pollue pas le cache, le prochain
    // appel doit tenter à nouveau (sinon une panne DB bloque 1000ms tout le
    // process). Si ce test rougit après refactor, c'est un régression
    // perf critique.
    expect(await cached("k-rej", 1000, fn)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("invalidate / invalidatePrefix", () => {
  it("invalidate() supprime exactement la clé ciblée", () => {
    const fn = vi.fn().mockReturnValueOnce("v1").mockReturnValueOnce("v2");

    cached("k", 60_000, fn);
    invalidate("k");
    cached("k", 60_000, fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("invalidatePrefix() supprime toutes les clés matchant le préfixe", () => {
    cached("user:1", 60_000, () => "ctx1");
    cached("user:2", 60_000, () => "ctx2");
    cached("plan:1", 60_000, () => "plan1");

    invalidatePrefix("user:");

    // user:* doivent ré-appeler fn ; plan:1 doit rester en cache.
    const fnU1 = vi.fn().mockReturnValue("ctx1-refresh");
    const fnU2 = vi.fn().mockReturnValue("ctx2-refresh");
    const fnP1 = vi.fn().mockReturnValue("plan1-refresh");

    expect(cached("user:1", 60_000, fnU1)).toBe("ctx1-refresh");
    expect(cached("user:2", 60_000, fnU2)).toBe("ctx2-refresh");
    expect(cached("plan:1", 60_000, fnP1)).toBe("plan1");

    expect(fnU1).toHaveBeenCalledTimes(1);
    expect(fnU2).toHaveBeenCalledTimes(1);
    expect(fnP1).not.toHaveBeenCalled();
  });

  it("invalidatePrefix('') vide tout le cache", () => {
    cached("a", 60_000, () => "a");
    cached("b", 60_000, () => "b");

    invalidatePrefix("");

    const fnA = vi.fn().mockReturnValue("a-fresh");
    expect(cached("a", 60_000, fnA)).toBe("a-fresh");
    expect(fnA).toHaveBeenCalledTimes(1);
  });
});
