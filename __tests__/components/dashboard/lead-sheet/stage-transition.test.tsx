/**
 * Tests source-level sur src/components/dashboard/lead-sheet/stage-transition.tsx
 *
 * La modale de transition de stage (`<StageTransitionModal>`) affichait
 * le titre via une fonction `stageLabel(stage)` avec un mapping hardcodé
 * Record<string, string> des 8 stages canoniques. Refonte 2026-05-23 :
 * `<StageLabel>` composant qui lit le hook workspace + findStageOrFallback,
 * donc le label custom des workspaces apparaît correctement.
 *
 * Sortie de tests-pending.txt 2026-05-23 (ticket pipeline-stages-
 * customisables) — le composant gagne enfin une couverture minimum.
 *
 * Run: npx vitest run __tests__/components/dashboard/lead-sheet/stage-transition.test.tsx
 */
import { describe, expect, test } from "vitest";

describe("stage-transition.tsx — label dynamique via hook (2026-05-23)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/lead-sheet/stage-transition.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("importe useWorkspacePipelineStages + findStageOrFallback depuis le hook", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*useWorkspacePipelineStages[^}]*findStageOrFallback[^}]*\}\s*from\s*["']@\/hooks\/use-pipeline-stages["']/,
    );
  });

  test("n'utilise PLUS un mapping Record<string, string> hardcodé pour les labels (sabotage = rouge)", () => {
    // Avant : `const labels: Record<string, string> = { fiche_ouverte: "...", ... }`
    // Après : composant StageLabel qui lit le hook au runtime.
    expect(source).not.toMatch(/const\s+labels\s*:\s*Record<string,\s*string>/);
  });

  test("définit un composant StageLabel qui rend le label depuis le hook", () => {
    expect(source).toMatch(/function\s+StageLabel/);
  });

  test("la modale utilise <StageLabel stage={targetStage} /> dans le DialogTitle", () => {
    expect(source).toContain("<StageLabel stage={targetStage} />");
  });
});
