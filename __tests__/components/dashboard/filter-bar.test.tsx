/**
 * Tests source-level sur src/components/dashboard/filter-bar.tsx.
 *
 * Anti-régression du fix UI mobile 2026-05-22 : la barre de filtres
 * (Recherche / Mobile / Géographie / Taille / Qualité / Historique)
 * débordait l'écran sur mobile via un `overflow-x-auto` (scroll
 * horizontal, libellés coupés). Le fix la passe en `flex-wrap` : les
 * boutons s'enroulent proprement sur plusieurs lignes.
 *
 * Pattern source-level (cf pipeline-board.test.tsx) : on lit le .tsx en
 * texte et on vérifie des invariants. But : attraper la régression si
 * quelqu'un re-passe la barre en scroll horizontal.
 */
import { describe, expect, test } from "vitest";

describe("filter-bar.tsx — responsive mobile (fix 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/filter-bar.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("le conteneur de la barre utilise flex-wrap", () => {
    // flex-wrap = les boutons s'enroulent sur plusieurs lignes en mobile.
    expect(source).toMatch(/className="flex items-center gap-2 flex-wrap"/);
  });

  test("la barre n'utilise plus overflow-x-auto (scroll horizontal)", () => {
    // overflow-x-auto sur la barre = l'ancien comportement débordant.
    expect(source).not.toMatch(/flex items-center gap-2 overflow-x-auto/);
  });

  test("conserve l'export FilterBar et ses boutons de filtre (sanity)", () => {
    expect(source).toMatch(/export function FilterBar/);
    expect(source).toMatch(/Geographie/);
    expect(source).toMatch(/Historique/);
  });
});
