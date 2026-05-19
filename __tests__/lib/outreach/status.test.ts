/**
 * Tests pour le helper canonique applyStatusTransition().
 *
 * Source de vérité : src/lib/outreach/status.ts
 */
import { describe, expect, test } from "vitest";
import {
  applyStatusTransition,
  pipelineStageForStatus,
} from "@/lib/outreach/status";

describe("applyStatusTransition — cohérence status/pipeline_stage", () => {
  test("fiche_ouverte sur lead vierge → écrit les 2 colonnes", () => {
    expect(applyStatusTransition("fiche_ouverte", null, null)).toEqual({
      status: "fiche_ouverte",
      pipeline_stage: "fiche_ouverte",
    });
  });

  test("appele (legacy) → repondeur côté pipeline", () => {
    expect(applyStatusTransition("appele", "fiche_ouverte", "fiche_ouverte")).toEqual({
      status: "appele",
      pipeline_stage: "repondeur",
    });
  });

  test("hors_cible (terminal) → toujours appliqué même si lead avancé", () => {
    expect(applyStatusTransition("hors_cible", "acompte", "acompte")).toEqual({
      status: "hors_cible",
      pipeline_stage: "hors_cible",
    });
  });

  test("pas_interesse depuis fiche_ouverte → terminal force OK", () => {
    expect(applyStatusTransition("pas_interesse", "fiche_ouverte", "fiche_ouverte")).toEqual({
      status: "pas_interesse",
      pipeline_stage: "pas_interesse",
    });
  });
});

describe("applyStatusTransition — anti-régression du funnel", () => {
  test("appel reçu sur lead en site_demo → IGNORE (pas de retour en arrière)", () => {
    expect(applyStatusTransition("appele", "site_demo", "site_demo")).toBeNull();
  });

  test("rappel sur lead en acompte → IGNORE", () => {
    expect(applyStatusTransition("rappeler", "acompte", "acompte")).toBeNull();
  });

  test("appel sur lead en a_rappeler → IGNORE (a_rappeler > repondeur)", () => {
    expect(applyStatusTransition("appele", "a_rappeler", "a_rappeler")).toBeNull();
  });

  test("nouvel appel sur fiche_ouverte → autorisé (progression)", () => {
    expect(applyStatusTransition("appele", "fiche_ouverte", "fiche_ouverte")).toEqual({
      status: "appele",
      pipeline_stage: "repondeur",
    });
  });

  test("desync existante (status=hors_cible, stage=fiche_ouverte) : applique terminal", () => {
    // Cas du bug initial sur staging : un lead avec status='hors_cible' mais
    // pipeline_stage='fiche_ouverte' (désync). Si on reapplique hors_cible,
    // les 2 colonnes doivent converger.
    expect(applyStatusTransition("hors_cible", "hors_cible", "fiche_ouverte")).toEqual({
      status: "hors_cible",
      pipeline_stage: "hors_cible",
    });
  });

  test("interesse (legacy) sur lead vierge → site_demo côté pipeline", () => {
    expect(applyStatusTransition("interesse", "fiche_ouverte", "fiche_ouverte")).toEqual({
      status: "interesse",
      pipeline_stage: "site_demo",
    });
  });
});

describe("pipelineStageForStatus — mapping sans anti-régression", () => {
  test("mappe chaque status legacy vers un stage canonique", () => {
    expect(pipelineStageForStatus("a_contacter")).toBe("fiche_ouverte");
    expect(pipelineStageForStatus("appele")).toBe("repondeur");
    expect(pipelineStageForStatus("rappeler")).toBe("a_rappeler");
    expect(pipelineStageForStatus("interesse")).toBe("site_demo");
    expect(pipelineStageForStatus("rdv")).toBe("site_demo");
    expect(pipelineStageForStatus("hors_cible")).toBe("hors_cible");
    expect(pipelineStageForStatus("pas_interesse")).toBe("pas_interesse");
    expect(pipelineStageForStatus("client")).toBe("client");
  });

  test("status inconnu → fallback fiche_ouverte (safe)", () => {
    expect(pipelineStageForStatus("status_qui_existe_pas_xyz")).toBe("fiche_ouverte");
  });
});
