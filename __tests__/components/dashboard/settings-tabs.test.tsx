/**
 * Source-level test pour src/components/dashboard/settings-tabs.tsx.
 *
 * Anti-régression fix overflow /settings iPhone SE 375px (commit 67eaa4c) :
 * la TabsList shadcn avec 5 onglets (Affichage, Téléphonie, Renvoi, IA,
 * Référence) avait largeur intrinsèque 702px qui poussait le viewport.
 * Fix : wrapper overflow-x-auto + w-max sur TabsList.
 * Si quelqu'un retire le wrapper, le bug réapparait silencieusement.
 */
import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

describe("settings-tabs.tsx — anti-régression overflow mobile 2026-05-23", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/settings-tabs.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("TabsList est wrappée dans un overflow-x-auto (anti scroll viewport)", () => {
    expect(source).toMatch(/overflow-x-auto/);
  });

  test("TabsList a w-max pour préserver largeur intrinsèque sous wrapper", () => {
    expect(source).toMatch(/w-max/);
  });
});
