/**
 * Tests unitaires pour src/hooks/use-pipeline-stages.ts (helpers purs)
 *
 * On teste UNIQUEMENT la fonction pure `findStageOrFallback` ici (les
 * branches React du hook sont couvertes par les tests source-level des
 * composants qui le consomment).
 *
 * Run: npx vitest run src/hooks/use-pipeline-stages.test.ts
 */
import { describe, it, expect } from "vitest";
import { findStageOrFallback, type PipelineStageView } from "./use-pipeline-stages";

function makeStage(over: Partial<PipelineStageView> = {}): PipelineStageView {
  return {
    id: "fiche_ouverte",
    slug: "fiche_ouverte",
    label: "Fiche ouverte",
    position: 0,
    color: "bg-indigo-500",
    bgLight: "bg-indigo-50",
    textColor: "text-indigo-700",
    isTerminal: false,
    isHidden: false,
    autoArchiveDays: 7,
    ...over,
  };
}

describe("findStageOrFallback", () => {
  it("retourne le stage trouvé quand le slug existe dans la liste", () => {
    const stages = [makeStage({ slug: "fiche_ouverte" }), makeStage({ slug: "site_demo", label: "Site démo" })];
    const result = findStageOrFallback(stages, "site_demo");
    expect(result.label).toBe("Site démo");
  });

  it("fallback sur la lib legacy pour un slug canonique manquant du workspace", () => {
    // Cas : le commercial avait des leads en "client" mais l'admin a soft-
    // deleted ce stage. Le slug doit toujours être affichable.
    const stages = [makeStage({ slug: "fiche_ouverte" })];
    const result = findStageOrFallback(stages, "client");
    // Le label vient du legacy (src/lib/types.ts PIPELINE_STAGES).
    expect(result.slug).toBe("client");
    expect(result.label).toBe("Client");
  });

  it("fallback synthétique neutre pour un slug totalement inconnu", () => {
    const stages = [makeStage({ slug: "fiche_ouverte" })];
    const result = findStageOrFallback(stages, "totally_custom_slug");
    expect(result.slug).toBe("totally_custom_slug");
    expect(result.label).toBe("totally_custom_slug"); // pas crash, juste le slug brut
    expect(result.color).toBe("bg-slate-500");
  });

  it("n'altère pas les stages d'origine (immutability)", () => {
    const stages = [makeStage({ slug: "fiche_ouverte", label: "Original" })];
    findStageOrFallback(stages, "fiche_ouverte");
    expect(stages[0].label).toBe("Original");
  });
});
