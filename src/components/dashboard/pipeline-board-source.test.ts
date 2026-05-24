/**
 * Test source-level pour pipeline-board.tsx, stage-transition.tsx, lead-header.tsx
 *
 * On vérifie au niveau du SOURCE FILE (pas du runtime) que la refonte
 * 2026-05-23 (pipeline-stages customisables par workspace) est en place :
 * les composants doivent lire les stages via le hook `useWorkspacePipelineStages`,
 * PAS via la constante hardcodée `PIPELINE_STAGES` de types.ts.
 *
 * Pattern Veridian (cf src/lib/auth/* tests) : on stresse le contenu brut
 * du fichier pour empêcher une régression silencieuse (un dev qui réimporte
 * accidentellement `PIPELINE_STAGES` en refactorant).
 *
 * Sabotage-test : remettre `import { PIPELINE_STAGES } from "@/lib/types"`
 * dans pipeline-board.tsx doit faire échouer ce test.
 *
 * Run: npx vitest run src/components/dashboard/pipeline-board-source.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("pipeline-board.tsx — dynamic stages", () => {
  const src = read("src/components/dashboard/pipeline-board.tsx");

  it("importe useWorkspacePipelineStages", () => {
    expect(src).toContain("useWorkspacePipelineStages");
  });

  it("n'importe PLUS PIPELINE_STAGES depuis @/lib/types", () => {
    // Match strict : `import { ..., PIPELINE_STAGES, ... } from "@/lib/types"`
    expect(src).not.toMatch(/import\s*\{[^}]*\bPIPELINE_STAGES\b[^}]*\}\s*from\s*["']@\/lib\/types["']/);
  });

  it("itère sur visibleStages (la valeur du hook), pas une constante", () => {
    expect(src).toContain("visibleStages.map");
  });
});

describe("lead-sheet/lead-header.tsx — dropdown dynamique", () => {
  const src = read("src/components/dashboard/lead-sheet/lead-header.tsx");

  it("importe useWorkspacePipelineStages", () => {
    expect(src).toContain("useWorkspacePipelineStages");
  });

  it("n'importe PLUS PIPELINE_STAGES depuis @/lib/types", () => {
    expect(src).not.toMatch(/import\s*\{[^}]*\bPIPELINE_STAGES\b[^}]*\}\s*from\s*["']@\/lib\/types["']/);
  });

  it("rend dropdownStages (filtré du hook), pas PIPELINE_STAGES", () => {
    expect(src).toContain("dropdownStages.map");
  });
});

describe("lead-sheet/stage-transition.tsx — label dynamique", () => {
  const src = read("src/components/dashboard/lead-sheet/stage-transition.tsx");

  it("importe useWorkspacePipelineStages et findStageOrFallback", () => {
    expect(src).toContain("useWorkspacePipelineStages");
    expect(src).toContain("findStageOrFallback");
  });

  it("n'utilise PLUS un objet labels: Record<string, string> hardcodé", () => {
    // Avant : `const labels: Record<string, string> = { fiche_ouverte: ... }`
    // Après : composant StageLabel qui lit le hook.
    expect(src).not.toMatch(/const\s+labels\s*:\s*Record<string,\s*string>/);
  });
});

// NOTE : le test source-level pour `lead-sheet/history-tab.tsx` a été
// retiré ici parce que ce fichier appartient au scope d'Agent O (ticket
// fiche-historique-prospect-360 Phase 1) — au moment où ce commit
// arrive sur staging, le fichier peut ne pas exister encore. À remettre
// dans un commit follow-up quand O aura mergé son ticket et que mon
// edit `useWorkspacePipelineStages` y sera repris (ou via PR coordonnée).

describe("lead-sheet.tsx — badge état pipeline dynamique", () => {
  const src = read("src/components/dashboard/lead-sheet.tsx");

  it("utilise findStageOrFallback pour résoudre le stage du lead", () => {
    expect(src).toContain("findStageOrFallback(workspaceStages");
  });

  it("n'utilise PLUS PIPELINE_STAGES.find pour le badge état pipeline", () => {
    expect(src).not.toMatch(/PIPELINE_STAGES\s*\.\s*find/);
  });
});
