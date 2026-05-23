/**
 * Tests source-level sur src/components/dashboard/segment-page.tsx.
 *
 * Pattern source-level (cf pipeline-board.test.tsx, sans-site-sidebar.test.tsx).
 *
 * Anti-régression bug intermittent /prospects (2026-05-23, commit d5ae9e8) :
 * bug-intermittent a posé Array.isArray() sur le payload `/api/segments`
 * pour éviter TypeError 'Cannot read properties of undefined (reading length)'
 * quand setSegments(d) reçoit un shape inattendu (race init chunk JS).
 */
import { describe, expect, test } from "vitest";

describe("segment-page.tsx — garde défensif setSegments (2026-05-23)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/segment-page.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("exporte SegmentPage (sanity)", () => {
    expect(source).toMatch(/export function SegmentPage/);
  });

  // Si quelqu'un retire le guard Array.isArray() autour de setSegments,
  // le bug intermittent revient → ce test rougit. Sabotage-testable :
  // remplacer `Array.isArray(d) ? d : []` par `d` → test rouge.
  test("setSegments protégé par Array.isArray (anti-régression)", () => {
    // accepte plusieurs variantes équivalentes
    const hasArrayIsArray = /setSegments\(\s*Array\.isArray\(/.test(source);
    const hasNullishFallback = /setSegments\(\s*\(?[a-zA-Z]+\s*\)?\s*\?\?\s*\[\]/.test(source);
    expect(hasArrayIsArray || hasNullishFallback).toBe(true);
  });
});
