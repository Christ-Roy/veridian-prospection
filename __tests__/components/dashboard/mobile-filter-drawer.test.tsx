/**
 * Tests source-level sur src/components/dashboard/mobile-filter-drawer.tsx.
 *
 * Sprint UI mobile 2026-05-22 : nouveau composant. Rassemble TOUS les
 * filtres `< md` dans un volet accordéon (recherche + secteur OU
 * sans-site + Géo/Taille/Qualité + Mobile uniquement + Historique).
 *
 * Pattern source-level (cf pipeline-board.test.tsx) — on vérifie les
 * invariants d'intégration avec les autres composants, pas le rendu.
 *
 * Régression à attraper :
 *  - le drawer redevient visible sur desktop (perte du `md:hidden`)
 *  - le drawer arrête de réutiliser `SectorFilterBody`/`SansSiteFilterBody`
 *    (et duplique la logique de fetch)
 *  - le bouton de fermeture repasse sous 44×44 (a11y mobile)
 *  - le `SheetDescription` disparaît (Radix → warning "no description")
 */
import { describe, expect, test } from "vitest";

describe("mobile-filter-drawer.tsx — composant nouveau (sprint 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/mobile-filter-drawer.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("exporte `MobileFilterDrawer`", () => {
    expect(source).toMatch(/export\s+function\s+MobileFilterDrawer\b/);
  });

  // ─── Mobile-only (md:hidden) ─────────────────────────────────────────
  test("le déclencheur est masqué à partir de md (`md:hidden`)", () => {
    // Sur desktop, FilterBar (visible md:flex) prend le relais — si le
    // burger reste visible en desktop, on a 2 jeux de filtres dupliqués.
    expect(source).toMatch(/data-testid="mobile-filter-trigger"/);
    // Le déclencheur a md:hidden dans son className (multi-ligne possible).
    const triggerBlock = source.match(
      /<Button[\s\S]*?data-testid="mobile-filter-trigger"[\s\S]*?<\/Button>/,
    );
    const triggerSrc = triggerBlock?.[0] || "";
    expect(triggerSrc.includes("md:hidden")).toBe(true);
  });

  // ─── Réutilisation des corps de filtre extraits ──────────────────────
  test("réutilise `SectorFilterBody` (pas de duplication de logique secteur)", () => {
    expect(source).toMatch(/import\s+\{\s*SectorFilterBody\s*\}\s+from\s+"\.\/sector-sidebar"/);
    expect(source).toMatch(/<SectorFilterBody\b/);
  });

  test("réutilise `SansSiteFilterBody` (pas de duplication de logique sans-site)", () => {
    expect(source).toMatch(
      /import\s+\{\s*SansSiteFilterBody,?\s*type\s+SansSiteFilterState\s*\}\s+from\s+"\.\/sans-site-sidebar"/,
    );
    expect(source).toMatch(/<SansSiteFilterBody\b/);
  });

  test("ne refetch PAS /api/sectors ni /api/sans-site-filters", () => {
    // Garde-fou : la logique de fetch reste dans les corps extraits, pas
    // dupliquée ici.
    expect(source).not.toMatch(/fetch\("\/api\/sectors"/);
    expect(source).not.toMatch(/fetch\("\/api\/sans-site-filters"/);
  });

  // ─── A11y mobile — cibles tactiles ───────────────────────────────────
  test("bouton de fermeture sized ≥ 44×44 (cible tactile WCAG 2.5.5)", () => {
    // Le close shadcn par défaut fait 16×16 → on l'a custom à h-11 w-11.
    expect(source).toMatch(/aria-label="Fermer les filtres"/);
    const closeBlock = source.match(/<SheetClose[\s\S]*?\/SheetClose>/);
    const closeSrc = closeBlock?.[0] || "";
    expect(closeSrc).toMatch(/h-11 w-11/);
  });

  test("expose un `SheetDescription` (évite warning Radix sans description)", () => {
    expect(source).toMatch(/<SheetDescription\b/);
    // Et il a la classe `sr-only` (visuel mais lu par les lecteurs d'écran)
    const descBlock = source.match(/<SheetDescription[\s\S]*?<\/SheetDescription>/);
    const descSrc = descBlock?.[0] || "";
    expect(descSrc).toMatch(/sr-only/);
  });

  // ─── Largeur responsive ──────────────────────────────────────────────
  test("le SheetContent est full-width sous `sm`, 400px à partir de `sm`", () => {
    expect(source).toMatch(/w-full sm:w-\[400px\]/);
  });

  // ─── Accordéon = repli par défaut ────────────────────────────────────
  test("utilise un `Accordion type=\"multiple\"` (filtres repliés par défaut)", () => {
    expect(source).toMatch(/from\s+"@\/components\/ui\/accordion"/);
    expect(source).toMatch(/<Accordion[^>]*type="multiple"/);
  });

  // ─── Toggle mobileOnly + historique câblés depuis les props ──────────
  test("câble `onToggleMobile` au bouton 'Mobile uniquement'", () => {
    expect(source).toMatch(/onClick=\{onToggleMobile\}/);
  });

  test("câble `onHistorique` / `onClearHistorique` selon `isHistoriqueActive`", () => {
    expect(source).toMatch(/isHistoriqueActive\s*\?\s*onClearHistorique\s*:\s*onHistorique/);
  });
});
