/**
 * Tests source-level sur src/components/dashboard/prospect-page.tsx.
 *
 * Anti-régression des fixes UI mobile 2026-05-22 :
 *  - Fix C : sous md, la table de prospects est remplacée par une liste
 *    de cartes (`ProspectCard`) — la table 1200px+ était inutilisable
 *    sur mobile. La table desktop reste affichée à partir de md.
 *  - Fix C : les actions qui font un fetch PATCH (ajout pipeline,
 *    changement de statut) affichent un toast en cas d'échec — avant,
 *    l'échec était silencieux.
 *  - Fix C : la carte prospect est accessible au clavier
 *    (role="button" + tabIndex + onKeyDown).
 *  - Fix barre filtres : la barre passe en flex-col sous md.
 *
 * Pattern source-level (cf pipeline-board.test.tsx).
 */
import { describe, expect, test } from "vitest";

describe("prospect-page.tsx — responsive mobile + feedback (2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/prospect-page.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Fix C — vue carte mobile : la table en hidden md:block, les cartes
  // en md:hidden. Régression si l'un des deux disparaît.
  test("la table de prospects est masquée sous md (hidden md:block)", () => {
    expect(source).toMatch(/hidden md:block/);
  });

  test("une vue carte mobile est rendue sous md (md:hidden + ProspectCard)", () => {
    expect(source).toMatch(/md:hidden/);
    expect(source).toMatch(/function ProspectCard/);
    expect(source).toMatch(/<ProspectCard/);
  });

  // Fix C — la carte prospect cliquable est accessible au clavier.
  test("la carte prospect est accessible au clavier", () => {
    expect(source).toMatch(/role="button"/);
    expect(source).toMatch(/tabIndex=\{0\}/);
    expect(source).toMatch(/onKeyDown/);
  });

  // Fix C — les actions PATCH qui échouent affichent un toast d'erreur,
  // l'échec ne passe plus inaperçu.
  test("les actions affichent un feedback toast en cas d'échec", () => {
    expect(source).toMatch(/toast\.error/);
  });

  // Fix barre filtres — la barre passe en colonne sous md.
  test("la barre de filtres passe en colonne sur mobile (flex-col md:flex-row)", () => {
    expect(source).toMatch(/flex-col md:flex-row/);
  });

  test("conserve l'export ProspectPage et l'import FilterBar (sanity)", () => {
    expect(source).toMatch(/export function ProspectPage/);
    expect(source).toMatch(/FilterBar/);
  });
});

describe("prospect-page.tsx — câblage MobileFilterDrawer (sprint 2026-05-22)", () => {
  // La FilterBar est passée en `hidden md:flex` — les filtres mobile vivent
  // maintenant dans `MobileFilterDrawer`. ProspectPage doit l'importer et
  // lui transmettre les mêmes handlers (sinon les filtres mobile sont morts).
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/prospect-page.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("importe MobileFilterDrawer depuis ./mobile-filter-drawer", () => {
    expect(source).toMatch(
      /import\s+\{\s*MobileFilterDrawer\s*\}\s+from\s+"\.\/mobile-filter-drawer"/,
    );
  });

  test("rend <MobileFilterDrawer ...> dans le JSX", () => {
    expect(source).toMatch(/<MobileFilterDrawer\b/);
  });

  // Les handlers historique/mobile-only sont maintenant nommés (extraits
  // en fonctions) pour pouvoir être passés à la fois à FilterBar (desktop)
  // et à MobileFilterDrawer (mobile) sans copy-paste.
  test("extrait les handlers `toggleMobileOnly`, `enterHistorique`, `exitHistorique`", () => {
    expect(source).toMatch(/function\s+toggleMobileOnly/);
    expect(source).toMatch(/function\s+enterHistorique/);
    expect(source).toMatch(/function\s+exitHistorique/);
  });
});
