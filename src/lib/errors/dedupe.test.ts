/**
 * Tests colocalisés pour @/lib/errors/dedupe.
 *
 * Helpers extraits de api/errors/route.ts (Next.js App Router interdit
 * exports nommés non-HTTP dans route.ts). Ces tests dupliquent
 * volontairement les 2 cas dédiés de __tests__/api/errors.test.ts
 * (computeDedupeKey + bucketToHour) pour satisfaire le mapping canonique
 * 1-source = 1-test colocalisé.
 *
 * Sabotage-test : altérer une fonction → tests rouges ici ET dans
 * errors.test.ts (les 2 tests dédiés).
 */
import { describe, expect, test } from "vitest";
import { computeDedupeKey, bucketToHour } from "./dedupe";

describe("computeDedupeKey", () => {
  test("retourne 16 chars hex stables", () => {
    const k = computeDedupeKey("hello", "x.js", 10);
    expect(k).toMatch(/^[a-f0-9]{16}$/);
    expect(computeDedupeKey("hello", "x.js", 10)).toBe(k);
  });

  test("sensible au message", () => {
    const k = computeDedupeKey("hello", "x.js", 10);
    expect(computeDedupeKey("hellox", "x.js", 10)).not.toBe(k);
  });

  test("sensible au filename", () => {
    const k = computeDedupeKey("hello", "x.js", 10);
    expect(computeDedupeKey("hello", "y.js", 10)).not.toBe(k);
  });

  test("sensible au lineno", () => {
    const k = computeDedupeKey("hello", "x.js", 10);
    expect(computeDedupeKey("hello", "x.js", 11)).not.toBe(k);
  });

  test("gère filename null + lineno null sans throw", () => {
    expect(computeDedupeKey("msg", null, null)).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("bucketToHour", () => {
  test("ramène une Date à HH:00:00.000 UTC", () => {
    const d = new Date("2026-05-23T14:37:42.500Z");
    const bucket = bucketToHour(d);
    expect(bucket.toISOString()).toBe("2026-05-23T14:00:00.000Z");
  });

  test("même heure UTC → même bucket (idempotent)", () => {
    const d1 = new Date("2026-05-23T14:01:00Z");
    const d2 = new Date("2026-05-23T14:59:59Z");
    expect(bucketToHour(d1).getTime()).toBe(bucketToHour(d2).getTime());
  });

  test("changement d'heure UTC → bucket différent", () => {
    const d1 = new Date("2026-05-23T14:59:59Z");
    const d2 = new Date("2026-05-23T15:00:00Z");
    expect(bucketToHour(d1).getTime()).not.toBe(bucketToHour(d2).getTime());
  });
});
