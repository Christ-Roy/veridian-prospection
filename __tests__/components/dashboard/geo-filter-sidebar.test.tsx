/**
 * Tests source-level sur src/components/dashboard/geo-filter-sidebar.tsx.
 *
 * Sprint UI mobile 2026-05-22 : le SheetContent était fixé à `w-[400px]`
 * peu importe le viewport. Sur 375px, le panneau Géo débordait à droite
 * de l'écran et la X de fermeture passait hors-cadre. Fix : `w-full` sous
 * `sm`, puis `sm:w-[400px]` à partir de `sm`.
 *
 * Pattern source-level (cf pipeline-board.test.tsx).
 *
 * Régression à attraper : si quelqu'un repasse à un width fixe sans
 * variant responsive, le débordement mobile revient.
 */
import { describe, expect, test } from "vitest";

describe("geo-filter-sidebar.tsx — responsive width Sheet (sprint 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/geo-filter-sidebar.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("le SheetContent passe en pleine largeur sous `sm`", () => {
    // w-full sm:w-[400px] = mobile fullscreen → desktop 400px.
    expect(source).toMatch(/w-full sm:w-\[400px\]/);
  });

  test("n'utilise plus un width fixe non-responsive (régression mobile)", () => {
    // Pattern interdit : `className="w-[400px] ` sans `w-full` avant.
    // Plus précis : un className SheetContent qui commence par w-[400px]
    // sans variant w-full prefixe.
    expect(source).not.toMatch(/className="w-\[400px\] sm:max-w-\[400px\]/);
  });

  test("conserve l'export GeoFilterSidebar (sanity)", () => {
    expect(source).toMatch(/export function GeoFilterSidebar/);
  });
});
