/**
 * Tests source-level sur src/components/dashboard/sans-site-sidebar.tsx.
 *
 * Sprint UI mobile 2026-05-22 : même refonte que sector-sidebar — on
 * extrait `SansSiteFilterBody` (corps réutilisable) et on conserve
 * `SansSiteSidebar` (wrapper latéral desktop). Le volet accordéon mobile
 * embarque le corps directement.
 *
 * Pattern source-level (cf pipeline-board.test.tsx).
 *
 * Régression à attraper : si quelqu'un re-met du `hidden md:block` dans
 * le corps (re-casse le rendu mobile dans le drawer) ou supprime
 * `EMPTY_SANS_SITE_STATE` (consommé par MobileFilterDrawer).
 */
import { describe, expect, test } from "vitest";

describe("sans-site-sidebar.tsx — extraction `SansSiteFilterBody` (sprint 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/sans-site-sidebar.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // ─── Export n°1 : SansSiteFilterBody — corps réutilisable ───────────
  test("exporte `SansSiteFilterBody` (corps réutilisé par MobileFilterDrawer)", () => {
    expect(source).toMatch(/export\s+function\s+SansSiteFilterBody\b/);
  });

  test("`SansSiteFilterBody` ne contient pas `<aside>` (corps interne)", () => {
    // On s'arrête au `\n}` final pour ne pas embarquer le JSDoc du wrapper.
    const bodyMatch = source.match(/export\s+function\s+SansSiteFilterBody[\s\S]*?\n\}\n/);
    expect(bodyMatch).toBeTruthy();
    const bodySrc = bodyMatch?.[0] || "";
    expect(bodySrc).not.toMatch(/<aside/);
    expect(bodySrc).not.toMatch(/hidden md:block/);
  });

  // ─── Export n°2 : SansSiteSidebar — wrapper latéral desktop ─────────
  test("exporte `SansSiteSidebar` (wrapper desktop)", () => {
    expect(source).toMatch(/export\s+function\s+SansSiteSidebar\b/);
  });

  test("`SansSiteSidebar` délègue à `SansSiteFilterBody` (pas de logique dupliquée)", () => {
    const wrapperMatch = source.match(
      /export\s+function\s+SansSiteSidebar[\s\S]*?(?=export\s+function|export\s+const|function\s+SansSiteItem|$)/,
    );
    const wrapperSrc = wrapperMatch?.[0] || "";
    expect(wrapperSrc).toMatch(/<SansSiteFilterBody\b/);
    expect(wrapperSrc).not.toMatch(/fetch\(/);
  });

  test("`SansSiteSidebar` reste desktop-only via `hidden md:block`", () => {
    const wrapperMatch = source.match(
      /export\s+function\s+SansSiteSidebar[\s\S]*?(?=export\s+function|export\s+const|function\s+SansSiteItem|$)/,
    );
    const wrapperSrc = wrapperMatch?.[0] || "";
    expect(wrapperSrc).toMatch(/hidden md:block/);
  });

  // ─── EMPTY_SANS_SITE_STATE — consommé par MobileFilterDrawer ────────
  test("conserve l'export `EMPTY_SANS_SITE_STATE` (consommé hors du fichier)", () => {
    expect(source).toMatch(/export const EMPTY_SANS_SITE_STATE/);
  });

  // ─── Cibles tactiles ─────────────────────────────────────────────────
  test("rangs cliquables expose une cible tactile ≥ 36px (min-h-[36px])", () => {
    expect(source).toMatch(/min-h-\[36px\]/);
  });

  // ─── Anti-régression bug intermittent /prospects (2026-05-23, commit d5ae9e8) ──
  // bug-intermittent a posé un guard défensif sur qualiopiSpecialites.length
  // pour éviter TypeError 'Cannot read properties of undefined (reading length)'
  // au 1er render quand l'API renvoie un shape inattendu. Si quelqu'un retire
  // le guard, ce test rougit.
  test("garde défensif sur qualiopiSpecialites?.length (anti-régression)", () => {
    // soit le optional chaining ?. soit fallback ?? []
    const hasOptionalChaining = /qualiopiSpecialites\?\.length/.test(source);
    const hasNullishFallback = /qualiopiSpecialites\s*\?\?\s*\[\]/.test(source);
    expect(hasOptionalChaining || hasNullishFallback).toBe(true);
  });
});
