/**
 * Tests source-level sur src/components/dashboard/size-filter-sidebar.tsx.
 *
 * Sprint UI mobile 2026-05-22 : même fix de débordement que `geo-filter-sidebar` —
 * le SheetContent passe à `w-full sm:w-[400px]`.
 *
 * Pattern source-level (cf pipeline-board.test.tsx).
 */
import { describe, expect, test } from "vitest";

describe("size-filter-sidebar.tsx — responsive width Sheet (sprint 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/size-filter-sidebar.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("le SheetContent passe en pleine largeur sous `sm`", () => {
    expect(source).toMatch(/w-full sm:w-\[400px\]/);
  });

  test("n'utilise plus un width fixe non-responsive (régression mobile)", () => {
    expect(source).not.toMatch(/className="w-\[400px\] sm:max-w-\[400px\]/);
  });

  test("conserve l'export SizeFilterSidebar (sanity)", () => {
    expect(source).toMatch(/export function SizeFilterSidebar/);
  });
});
