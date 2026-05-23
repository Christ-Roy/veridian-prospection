/**
 * Tests source-level sur src/components/layout/app-nav.tsx.
 *
 * Anti-régression des fixes UI mobile 2026-05-22 :
 *  - Fix #1 : entre md et lg, les libellés de la nav passent en
 *    icônes-seules (`hidden lg:inline`) pour que le header ne déborde
 *    plus en 768-1000px sur /prospects (toggle site + 7 liens).
 *  - Fix #4 : le toggle « avec/sans site » a été ajouté au menu
 *    hamburger mobile — il n'était accessible que dans la nav desktop.
 *
 * Pattern source-level (cf pipeline-board.test.tsx).
 */
import { describe, expect, test } from "vitest";

describe("app-nav.tsx — responsive header + toggle mobile (2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/layout/app-nav.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Fix #1 — libellés masqués entre md et lg pour éviter le débordement.
  test("les libellés de nav passent en icônes-seules sous lg", () => {
    expect(source).toMatch(/hidden lg:inline/);
  });

  // Fix #4 — toggle site dans le menu hamburger mobile.
  test("le menu hamburger mobile contient le toggle site", () => {
    expect(source).toMatch(/data-testid="site-toggle-mobile"/);
  });

  test("le toggle mobile a ses 3 entrées (all / with / without)", () => {
    expect(source).toMatch(/data-testid="site-toggle-mobile-all"/);
    expect(source).toMatch(/data-testid="site-toggle-mobile-with"/);
    expect(source).toMatch(/data-testid="site-toggle-mobile-without"/);
  });

  test("le toggle desktop site-toggle existe toujours (sanity, couvert e2e)", () => {
    // prospects-full-flow.spec.ts cible ce testid au viewport desktop.
    expect(source).toMatch(/data-testid="site-toggle"/);
  });

  test("conserve l'export AppNav et le menu hamburger md:hidden (sanity)", () => {
    expect(source).toMatch(/export function AppNav/);
    expect(source).toMatch(/md:hidden/);
  });

  // Anti-régression hotfix 2026-05-23 : bug prod où un user arrivé via
  // token Hub n'avait aucun moyen visible de se déconnecter pour utiliser
  // un autre compte. Le bouton signOut doit rester accessible — sinon la
  // pratique démo / machine partagée / switch tenant est bloquée.
  test("expose un bouton signOut (LogOut + handleSignOut)", () => {
    // L'import explicite de signOut Auth.js v5 prouve qu'on utilise le bon
    // mécanisme, pas un fetch maison.
    expect(source).toMatch(/import\s+{[^}]*signOut[^}]*}\s+from\s+["']next-auth\/react["']/);
    // L'icône LogOut de lucide identifie le bouton dans la nav.
    expect(source).toMatch(/import\s+{[^}]*\bLogOut\b/);
    // Le handler doit appeler signOut avec callbackUrl /login pour ne pas
    // laisser l'user sur une page authentifiée après déconnexion.
    expect(source).toMatch(/signOut\(\s*\{[^}]*callbackUrl:\s*["']\/login["']/);
  });

  test("expose le bouton signOut en desktop (à côté de NotificationBell)", () => {
    // Reconnaît la zone : <LogOut /> wrappée dans un button avec hidden md:inline-flex
    // (desktop only — mobile l'a dans le burger).
    expect(source).toMatch(/hidden md:inline-flex/);
    expect(source).toMatch(/<LogOut className/);
  });

  test("expose le bouton signOut dans le menu mobile (burger) avec l'email", () => {
    // Le menu mobile doit afficher l'email courant ("Connecté : X")
    // et un bouton "Se déconnecter".
    expect(source).toMatch(/Connect[ée]\s*:/);
    expect(source).toMatch(/Se d[ée]connecter/);
  });
});
