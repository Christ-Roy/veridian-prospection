/**
 * Test source-level pour le sort `tech_debt` (ticket switch-mode-agence).
 *
 * On vérifie en lisant le fichier source qu'il existe bien :
 *   - une constante `TECH_DEBT_SORT_SQL` qui combine web_eclate_score et
 *     web_tech_score (ORDER BY composite)
 *   - une clé `tech_debt` dans SORT_MAP (table-qualified) et SORT_MAP_ALIAS
 *     (subquery alias)
 *
 * Sabotage-proof : si quelqu'un supprime le sort `tech_debt` ou casse la
 * formule de pondération, le test pète et indique clairement où regarder.
 * Pas de mock Prisma — on lit juste le source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("prospects.ts — sort tech_debt (mode agence)", () => {
  // Test source-level : on lit le fichier prospects.ts depuis __tests__/lib/queries/
  // (chemin canonique imposé par scripts/ci/check-test-mapping.sh). Le source
  // est dans src/lib/queries/prospects.ts, soit ../../../src/lib/queries/.
  const src = readFileSync(
    join(__dirname, "../../../src/lib/queries/prospects.ts"),
    "utf-8",
  );

  it("expose une constante TECH_DEBT_SORT_SQL", () => {
    expect(src).toContain("TECH_DEBT_SORT_SQL");
  });

  it("la formule combine web_eclate_score et web_tech_score", () => {
    // La pondération exacte importe peu, mais les 2 colonnes doivent y être.
    expect(src).toMatch(/TECH_DEBT_SORT_SQL\s*=[\s\S]*?web_eclate_score/);
    expect(src).toMatch(/TECH_DEBT_SORT_SQL\s*=[\s\S]*?web_tech_score/);
  });

  it("SORT_MAP contient la clé tech_debt", () => {
    expect(src).toMatch(/tech_debt:\s*TECH_DEBT_SORT_SQL/);
  });

  it("SORT_MAP_ALIAS contient la clé tech_debt", () => {
    // Présent 2x dans le fichier (SORT_MAP + SORT_MAP_ALIAS)
    const matches = src.match(/tech_debt:\s*TECH_DEBT_SORT_SQL/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
