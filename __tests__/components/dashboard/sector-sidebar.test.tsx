/**
 * Tests source-level sur src/components/dashboard/sector-sidebar.tsx.
 *
 * Sprint UI mobile 2026-05-22 : la sidebar secteur était `hidden md:block`,
 * donc absente sur mobile. Le filtre par secteur était injoignable sur
 * 375px. Refonte : on extrait `SectorFilterBody` (corps réutilisable) et
 * on garde `SectorSidebar` (wrapper latéral desktop). Le volet accordéon
 * mobile (`MobileFilterDrawer`) embarque `SectorFilterBody` directement.
 *
 * Pattern source-level (cf pipeline-board.test.tsx).
 *
 * Régression à attraper : si quelqu'un re-fusionne corps et wrapper (perd
 * la réutilisabilité mobile) ou re-rajoute `hidden md:block` sur le corps
 * (re-casse le rendu mobile dans le drawer).
 */
import { describe, expect, test } from "vitest";

describe("sector-sidebar.tsx — extraction `SectorFilterBody` (sprint 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/sector-sidebar.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // ─── Export n°1 : SectorFilterBody — corps réutilisable ─────────────
  test("exporte `SectorFilterBody` (corps réutilisé par MobileFilterDrawer)", () => {
    expect(source).toMatch(/export\s+function\s+SectorFilterBody\b/);
  });

  test("`SectorFilterBody` ne contient pas `<aside>` (corps interne)", () => {
    // Le corps doit pouvoir être embarqué dans un AccordionContent
    // mobile sans wrapper latéral. Si on remet un <aside ... hidden md:block>
    // dans le corps, le drawer mobile devient invisible.
    // On s'arrête au `\n}` final pour ne pas embarquer le JSDoc du wrapper.
    const bodyMatch = source.match(/export\s+function\s+SectorFilterBody[\s\S]*?\n\}\n/);
    expect(bodyMatch).toBeTruthy();
    const bodySrc = bodyMatch?.[0] || "";
    expect(bodySrc).not.toMatch(/<aside/);
    expect(bodySrc).not.toMatch(/hidden md:block/);
  });

  // ─── Export n°2 : SectorSidebar — wrapper latéral desktop ───────────
  test("exporte `SectorSidebar` (wrapper desktop)", () => {
    expect(source).toMatch(/export\s+function\s+SectorSidebar\b/);
  });

  test("`SectorSidebar` reste desktop-only via `hidden md:block`", () => {
    const wrapperMatch = source.match(/export\s+function\s+SectorSidebar[\s\S]*$/);
    const wrapperSrc = wrapperMatch?.[0] || "";
    expect(wrapperSrc).toMatch(/hidden md:block/);
    expect(wrapperSrc).toMatch(/<aside/);
  });

  test("`SectorSidebar` délègue à `SectorFilterBody` (pas de logique dupliquée)", () => {
    // Le wrapper doit utiliser le corps, pas re-fetcher les données.
    const wrapperMatch = source.match(/export\s+function\s+SectorSidebar[\s\S]*$/);
    const wrapperSrc = wrapperMatch?.[0] || "";
    expect(wrapperSrc).toMatch(/<SectorFilterBody\b/);
    expect(wrapperSrc).not.toMatch(/fetch\(/);
  });

  // ─── Cibles tactiles — min-h-[32px] sur les rangs cliquables ─────────
  test("rangs cliquables expose une cible tactile ≥ 32px (min-h-[32px])", () => {
    // Le sprint a aussi élargi les checkboxes (h-3 → h-4) et imposé une
    // hauteur min de 32px sur les labels pour respecter le seuil tactile.
    expect(source).toMatch(/min-h-\[32px\]/);
  });

  test("checkboxes ne sont plus à 12px (h-3 w-3) — passées à h-4 w-4", () => {
    // Les checkboxes h-3 (12px) étaient sous le seuil cliquable mobile.
    expect(source).not.toMatch(/className="h-3 w-3"/);
    expect(source).toMatch(/className="h-4 w-4 shrink-0"/);
  });
});
