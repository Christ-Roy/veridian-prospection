/**
 * Tests source-level sur src/components/dashboard/lead-sheet/lead-header.tsx
 *
 * Le composant `<LeadHeader>` est large (sélecteur de stage + boutons
 * d'action). On verrouille ici la propriété la plus régressive : le
 * dropdown de transition de stage DOIT lire les stages via le hook
 * `useWorkspacePipelineStages` (pas la constante PIPELINE_STAGES de
 * types.ts) — sinon les workspaces avec des stages custom ne voient pas
 * leurs stages dans la fiche lead.
 *
 * Sortie de tests-pending.txt 2026-05-23 (ticket pipeline-stages-
 * customisables) — le composant gagne enfin une couverture minimum.
 *
 * Run: npx vitest run __tests__/components/dashboard/lead-sheet/lead-header.test.tsx
 */
import { describe, expect, test } from "vitest";

describe("lead-header.tsx — dropdown stage dynamique (2026-05-23)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/lead-sheet/lead-header.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("importe useWorkspacePipelineStages depuis le hook partagé", () => {
    expect(source).toMatch(
      /import\s*\{\s*useWorkspacePipelineStages\s*\}\s*from\s*["']@\/hooks\/use-pipeline-stages["']/,
    );
  });

  test("n'importe PLUS PIPELINE_STAGES depuis @/lib/types (sabotage : ré-importer = rouge)", () => {
    expect(source).not.toMatch(
      /import\s*\{[^}]*\bPIPELINE_STAGES\b[^}]*\}\s*from\s*["']@\/lib\/types["']/,
    );
  });

  test("itère sur dropdownStages (issu du hook), pas une constante hardcodée", () => {
    expect(source).toContain("dropdownStages.map");
  });

  test("filtre les stages isHidden du dropdown SAUF si le lead courant les porte", () => {
    // Pattern caractéristique : on garde un stage isHidden uniquement si
    // c'est le slug actif du lead courant — sinon l'option ne s'affiche
    // jamais et le <Select> a un value introuvable.
    expect(source).toMatch(/!s\.isHidden\s*\|\|\s*s\.slug\s*===\s*status/);
  });
});
