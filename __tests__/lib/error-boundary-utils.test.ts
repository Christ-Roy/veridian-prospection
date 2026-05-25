import { describe, expect, it, vi } from "vitest";
import { attemptReloadOnce, isChunkLoadError } from "@/lib/error-boundary-utils";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    _map: map,
  };
}

describe("isChunkLoadError", () => {
  it("matches a ChunkLoadError by name", () => {
    const err = Object.assign(new Error("oops"), { name: "ChunkLoadError" });
    expect(isChunkLoadError(err)).toBe(true);
  });

  it("matches by message containing 'Loading chunk'", () => {
    const err = new Error("Loading chunk 9773 failed");
    expect(isChunkLoadError(err)).toBe(true);
  });

  it("matches dynamic import failure messages", () => {
    const err = new Error(
      "Failed to fetch dynamically imported module: https://prospection.staging.veridian.site/_next/static/chunks/app/leads/buy/page-7393e8b4b5a40595.js",
    );
    expect(isChunkLoadError(err)).toBe(true);
  });

  it("matches CSS chunk failures", () => {
    const err = new Error("Loading CSS chunk 42 failed");
    expect(isChunkLoadError(err)).toBe(true);
  });

  it("does not match generic React errors", () => {
    const err = new Error("Cannot read properties of undefined (reading 'foo')");
    expect(isChunkLoadError(err)).toBe(false);
  });

  it("does not throw on null/undefined", () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("attemptReloadOnce", () => {
  it("reloads once on first call and writes the counter", () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    const ok = attemptReloadOnce({ storage, now: () => 1000, reload });
    expect(ok).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage._map.get("veridian:error-boundary:reload-count")).toBe("1");
  });

  it("reloads twice within the window then stops", () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    // 3 calls dans la fenêtre 30s — devraient s'arrêter après 2 reloads.
    attemptReloadOnce({ storage, now: () => 1000, reload });
    attemptReloadOnce({ storage, now: () => 5000, reload });
    const third = attemptReloadOnce({ storage, now: () => 10_000, reload });
    expect(reload).toHaveBeenCalledTimes(2);
    expect(third).toBe(false);
  });

  it("resets the counter after the 30s window expires", () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    attemptReloadOnce({ storage, now: () => 1000, reload });
    attemptReloadOnce({ storage, now: () => 5000, reload });
    // 3e tentative en dehors de la fenêtre — counter reset.
    const third = attemptReloadOnce({ storage, now: () => 40_000, reload });
    expect(third).toBe(true);
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it("falls back to reload when storage is unavailable", () => {
    const reload = vi.fn();
    const ok = attemptReloadOnce({ storage: null, reload });
    expect(ok).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
