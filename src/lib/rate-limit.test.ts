/**
 * Unit tests for src/lib/rate-limit.ts — pure in-memory sliding window.
 *
 * Tests rapides, aucune dépendance externe (pas de Prisma, pas de réseau).
 * Run: npx vitest run src/lib/rate-limit.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { isRateLimited } from "./rate-limit";

describe("isRateLimited", () => {
  beforeEach(() => {
    // Each test uses a fresh key to avoid cross-test state leak
    // (the module keeps an internal buckets Map that persists within a run)
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    const key = `test-under-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(key, 5, 60_000)).toBe(false);
    }
  });

  it("blocks once max is reached", () => {
    const key = `test-block-${Date.now()}-${Math.random()}`;
    // Fill up to the limit
    for (let i = 0; i < 3; i++) {
      expect(isRateLimited(key, 3, 60_000)).toBe(false);
    }
    // Next call should be blocked
    expect(isRateLimited(key, 3, 60_000)).toBe(true);
    // And subsequent calls remain blocked within the window
    expect(isRateLimited(key, 3, 60_000)).toBe(true);
  });

  it("isolates keys independently", () => {
    const keyA = `test-iso-a-${Date.now()}`;
    const keyB = `test-iso-b-${Date.now()}`;
    // keyA hits the limit
    for (let i = 0; i < 2; i++) isRateLimited(keyA, 2, 60_000);
    expect(isRateLimited(keyA, 2, 60_000)).toBe(true);
    // keyB is untouched and should still be allowed
    expect(isRateLimited(keyB, 2, 60_000)).toBe(false);
    expect(isRateLimited(keyB, 2, 60_000)).toBe(false);
    expect(isRateLimited(keyB, 2, 60_000)).toBe(true);
  });

  it("resets after the window slides past", async () => {
    const key = `test-window-${Date.now()}-${Math.random()}`;
    // Use a tiny window (50ms) so we don't slow down the test suite
    const WINDOW_MS = 50;
    for (let i = 0; i < 2; i++) {
      expect(isRateLimited(key, 2, WINDOW_MS)).toBe(false);
    }
    expect(isRateLimited(key, 2, WINDOW_MS)).toBe(true);

    // Wait past the window
    await new Promise((r) => setTimeout(r, WINDOW_MS + 20));
    // First request after the window is a fresh slot
    expect(isRateLimited(key, 2, WINDOW_MS)).toBe(false);
  });

  it("handles maxRequests=1 (strict 1/window)", () => {
    const key = `test-strict-${Date.now()}-${Math.random()}`;
    expect(isRateLimited(key, 1, 60_000)).toBe(false);
    expect(isRateLimited(key, 1, 60_000)).toBe(true);
    expect(isRateLimited(key, 1, 60_000)).toBe(true);
  });

  it("handles maxRequests=0 (immediately blocks everything)", () => {
    const key = `test-zero-${Date.now()}-${Math.random()}`;
    // With max=0, every request is blocked
    expect(isRateLimited(key, 0, 60_000)).toBe(true);
    expect(isRateLimited(key, 0, 60_000)).toBe(true);
  });
});
