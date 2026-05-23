/**
 * Source-level test pour src/components/dashboard/settings-display.tsx.
 *
 * Anti-régression fix overflow /settings iPhone SE 375px (commit 67eaa4c) :
 * 2× grid grid-cols-2 collapsés en grid-cols-1 sm:grid-cols-2 (stack
 * vertical mobile, 2 colonnes ≥640px). Sans ça, le grid 2-col à 375px
 * pousse les inputs hors viewport.
 */
import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

describe("settings-display.tsx — collapse grid mobile 2026-05-23", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/settings-display.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("aucun grid-cols-2 brut sans variant responsive (anti overflow mobile)", () => {
    // Pattern attendu : grid-cols-1 sm:grid-cols-2 ; PAS grid-cols-2 nu
    // Cherche `grid-cols-2` qui n'est PAS précédé de `sm:` (ou md:/lg:/xl:)
    // Match toute occurrence de grid-cols-2 puis filtre celles qui ont
    // un prefix responsive immédiat.
    const matches = source.match(/\b(?:[a-z]+:)?grid-cols-2\b/g) ?? [];
    const bareGridCols2 = matches.filter((m) => !/:grid-cols-2/.test(m));
    expect(bareGridCols2).toEqual([]);
  });

  test("au moins une déclaration grid-cols-1 sm:grid-cols-2 (le fix)", () => {
    expect(source).toMatch(/grid-cols-1\s+sm:grid-cols-2/);
  });
});
