/**
 * Tests unitaires pour src/lib/outreach/pipeline-stages.ts
 *
 * Source-level + helpers purs. Le test branche-DB des routes API vit dans
 * e2e/ (Playwright sur staging réel), ici on couvre :
 *  - DEFAULT_PIPELINE_STAGES alignés avec la migration 0019 SQL
 *  - slugifyStage normalise + tronque + refuse les bouillies
 *
 * Sabotage-test : muter DEFAULT_PIPELINE_STAGES.length à 7 doit faire
 * échouer l'assertion "8 stages canoniques alignés migration" (cf
 * memory feedback_sabotage_test_audit).
 *
 * Run: npx vitest run src/lib/outreach/pipeline-stages.test.ts
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_PIPELINE_STAGES, slugifyStage } from "./pipeline-stages";

describe("DEFAULT_PIPELINE_STAGES", () => {
  it("contient exactement les 8 stages canoniques historiques", () => {
    expect(DEFAULT_PIPELINE_STAGES).toHaveLength(8);
    const slugs = DEFAULT_PIPELINE_STAGES.map((s) => s.slug);
    expect(slugs).toEqual([
      "fiche_ouverte",
      "repondeur",
      "a_rappeler",
      "site_demo",
      "acompte",
      "finition",
      "client",
      "upsell",
    ]);
  });

  it("positions sont 0..7 strictement croissantes", () => {
    DEFAULT_PIPELINE_STAGES.forEach((s, i) => {
      expect(s.position).toBe(i);
    });
  });

  it("chaque stage a un label non-vide et une couleur Tailwind", () => {
    DEFAULT_PIPELINE_STAGES.forEach((s) => {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.color).toMatch(/^bg-[a-z]+-\d+$/);
    });
  });
});

describe("slugifyStage", () => {
  it("normalise en lowercase snake_case ascii", () => {
    expect(slugifyStage("Hello World")).toBe("hello_world");
    expect(slugifyStage("RDV planifié")).toBe("rdv_planifie");
    expect(slugifyStage("Été — démo")).toBe("ete_demo");
  });

  it("retire les caractères de bord", () => {
    expect(slugifyStage("   leading")).toBe("leading");
    expect(slugifyStage("trailing   ")).toBe("trailing");
    expect(slugifyStage("___middle___")).toBe("middle");
  });

  it("tronque à 64 caractères", () => {
    const long = "a".repeat(100);
    expect(slugifyStage(long).length).toBeLessThanOrEqual(64);
  });

  it("retourne une chaîne vide si rien d'utilisable", () => {
    expect(slugifyStage("@#$%^&*()")).toBe("");
    expect(slugifyStage("   ")).toBe("");
  });

  it("collapse les séparateurs multiples", () => {
    expect(slugifyStage("a    b")).toBe("a_b");
    expect(slugifyStage("a-b/c d")).toBe("a_b_c_d");
  });
});
