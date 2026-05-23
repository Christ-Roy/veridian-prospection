/**
 * Source-level test pour src/components/dashboard/settings-reference.tsx.
 *
 * Anti-régression fix overflow /settings iPhone SE 375px (commit 67eaa4c) :
 * 6 <table> wrappées défensivement dans overflow-x-auto (cellules font-mono
 * longues qui peuvent forcer la largeur intrinsèque).
 */
import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

describe("settings-reference.tsx — tables wrappées overflow-x 2026-05-23", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/settings-reference.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("chaque <table> est précédée d'un wrapper overflow-x-auto", () => {
    const tableCount = (source.match(/<table\b/g) ?? []).length;
    const wrappedCount = (source.match(/overflow-x-auto/g) ?? []).length;
    expect(tableCount).toBeGreaterThan(0);
    // au moins autant de wrappers que de tables (le wrapper peut être réutilisé)
    expect(wrappedCount).toBeGreaterThanOrEqual(tableCount);
  });
});
