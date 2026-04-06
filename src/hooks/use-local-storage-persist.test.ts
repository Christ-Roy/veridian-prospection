/**
 * Unit tests for useLocalStoragePersist helpers.
 * We test the low-level read/write via __localStorageInternals because
 * testing the hook itself requires a DOM environment that vitest doesn't
 * have by default in this project. The hook logic is thin wiring over
 * these helpers.
 *
 * Run: npx vitest run src/hooks/use-local-storage-persist.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { __localStorageInternals } from "./use-local-storage-persist";

const { read, write } = __localStorageInternals;

// Minimal localStorage mock
function installMockStorage() {
  const store = new Map<string, string>();
  const mock = {
    getItem: vi.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      store.delete(k);
    }),
    clear: vi.fn(() => store.clear()),
    key: vi.fn((i: number) => Array.from(store.keys())[i] ?? null),
    get length() {
      return store.size;
    },
  } as unknown as Storage;

  // Install as globalThis.window.localStorage
  const g = globalThis as unknown as { window?: { localStorage: Storage } };
  g.window = g.window || ({ localStorage: mock } as { localStorage: Storage });
  g.window.localStorage = mock;
  return mock;
}

describe("useLocalStoragePersist helpers", () => {
  beforeEach(() => {
    installMockStorage();
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  describe("read", () => {
    it("returns fallback when key is absent", () => {
      expect(read("missing", "default")).toBe("default");
      expect(read("missing", 42)).toBe(42);
      expect(read<string[]>("missing", [])).toEqual([]);
    });

    it("returns parsed value when key exists", () => {
      window.localStorage.setItem("k1", JSON.stringify({ foo: "bar" }));
      expect(read("k1", {} as Record<string, string>)).toEqual({ foo: "bar" });
    });

    it("returns fallback on invalid JSON", () => {
      window.localStorage.setItem("bad", "not json {{{");
      expect(read("bad", "default")).toBe("default");
    });

    it("handles arrays", () => {
      window.localStorage.setItem("arr", JSON.stringify([1, 2, 3]));
      expect(read<number[]>("arr", [])).toEqual([1, 2, 3]);
    });

    it("handles null stored value", () => {
      window.localStorage.setItem("nullish", JSON.stringify(null));
      expect(read("nullish", "fallback")).toBe(null);
    });
  });

  describe("write", () => {
    it("serializes and stores the value", () => {
      write("k", { a: 1, b: "two" });
      const raw = window.localStorage.getItem("k");
      expect(raw).toBe(JSON.stringify({ a: 1, b: "two" }));
    });

    it("overwrites existing value", () => {
      write("k", "first");
      write("k", "second");
      expect(window.localStorage.getItem("k")).toBe(JSON.stringify("second"));
    });

    it("handles arrays and primitives", () => {
      write("arr", [1, 2, 3]);
      expect(window.localStorage.getItem("arr")).toBe("[1,2,3]");
      write("num", 42);
      expect(window.localStorage.getItem("num")).toBe("42");
      write("bool", true);
      expect(window.localStorage.getItem("bool")).toBe("true");
    });
  });

  describe("SSR safety", () => {
    it("read returns fallback when window is undefined", () => {
      delete (globalThis as unknown as { window?: unknown }).window;
      expect(read("any", "ssr-fallback")).toBe("ssr-fallback");
    });

    it("write is a no-op when window is undefined", () => {
      delete (globalThis as unknown as { window?: unknown }).window;
      // Should not throw
      expect(() => write("any", { foo: "bar" })).not.toThrow();
    });
  });

  describe("roundtrip", () => {
    it("preserves objects through write → read", () => {
      const payload = {
        searchTerm: "bou",
        geoDepts: ["75", "69"],
        sizeFilter: "11",
        qualityFilter: "high",
        preset: "top_prospects",
      };
      write("prospect-filters-v1", payload);
      const restored = read("prospect-filters-v1", {});
      expect(restored).toEqual(payload);
    });
  });
});
