/**
 * Tests source-level sur src/components/dashboard/segment-table.tsx.
 *
 * Pattern source-level (cf pipeline-board.test.tsx, segment-page.test.tsx).
 *
 * Audit défensif setters async post bug-intermittent (commit d5ae9e8) :
 * `setData(json)` direct + `data.data.map()` ligne plus bas faisait
 * exactement le crash TypeError 'Cannot read properties of undefined
 * (reading length)' sur /segments/<id> si shape inattendu.
 */
import { describe, expect, test } from "vitest";

describe("segment-table.tsx — guard défensif setData (audit setters 2026-05-23)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/segment-table.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("exporte SegmentTable (sanity)", () => {
    expect(source).toMatch(/export function SegmentTable/);
  });

  // Bug originel intermittent : `data.data.map(...)` throw si data.data
  // n'est pas un array. setData doit valider Array.isArray(json.data)
  // sinon fallback null (le render gère déjà data === null via skeleton +
  // pagination conditionnelle).
  test("res.ok est checké avant .json()", () => {
    expect(source).toMatch(/if\s*\(\s*!res\.ok\s*\)/);
  });

  test("setData validé par Array.isArray(json.data) (sabotage-testable)", () => {
    // Pattern dangereux : setData(json) direct sur fetch sans guard.
    expect(source).not.toMatch(/const\s+json\s*=\s*await\s+res\.json\(\)\s*;\s*setData\(\s*json\s*\)\s*;/);
    // Pattern attendu : guard explicite.
    expect(source).toMatch(/setData\(\s*json\s*&&\s*Array\.isArray\(\s*json\.data\s*\)\s*\?\s*json\s*:\s*null\s*\)/);
  });

  test("fetch wrappé dans try/catch (pas d'unhandledrejection si res throw)", () => {
    // La fonction fetchData doit avoir try/catch/finally pour que setLoading
    // soit toujours remis à false même en cas d'erreur réseau.
    expect(source).toMatch(/try\s*\{[\s\S]*fetch\(\s*`\/api\/segments\//);
    expect(source).toMatch(/\}\s*catch\s*\{[\s\S]*setData\(\s*null\s*\)/);
    expect(source).toMatch(/\}\s*finally\s*\{[\s\S]*setLoading\(\s*false\s*\)/);
  });
});
