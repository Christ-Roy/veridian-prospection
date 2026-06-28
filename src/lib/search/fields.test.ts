import { describe, it, expect } from "vitest";
import { FIELD_CATALOG, FIELD_KEYS, resolveField } from "./fields";

describe("FIELD_CATALOG — intégrité du catalogue", () => {
  it("chaque champ a une expression SQL non vide et des opérateurs", () => {
    for (const [key, def] of Object.entries(FIELD_CATALOG)) {
      expect(def.sql, `${key}.sql`).toBeTruthy();
      expect(def.ops.length, `${key}.ops`).toBeGreaterThan(0);
      expect(def.label, `${key}.label`).toBeTruthy();
    }
  });

  it("les expressions SQL ne référencent que les alias e. ou o. (pas d'input)", () => {
    for (const [key, def] of Object.entries(FIELD_CATALOG)) {
      expect(def.sql.includes("e.") || def.sql.includes("o."), `${key} alias`).toBe(true);
    }
  });

  it("les champs enum déclarent des allowed_values", () => {
    for (const [key, def] of Object.entries(FIELD_CATALOG)) {
      if (def.type === "enum") {
        expect(def.enumValues, `${key}.enumValues`).toBeDefined();
        expect(def.enumValues!.length).toBeGreaterThan(0);
      }
    }
  });

  it("les champs booléens n'autorisent que eq/exists", () => {
    for (const [key, def] of Object.entries(FIELD_CATALOG)) {
      if (def.type === "boolean") {
        expect(def.ops.every((o) => o === "eq" || o === "exists"), `${key}.ops`).toBe(true);
      }
    }
  });

  it("resolveField renvoie null pour un champ inconnu (anti-injection)", () => {
    expect(resolveField("siren")).not.toBeNull();
    expect(resolveField("siren; DROP TABLE x")).toBeNull();
    expect(resolveField("")).toBeNull();
  });

  it("FIELD_KEYS reflète bien les clés du catalogue", () => {
    expect(FIELD_KEYS.length).toBe(Object.keys(FIELD_CATALOG).length);
    expect(FIELD_KEYS).toContain("chiffre_affaires");
  });

  it("fiche_confiance (réservoir ODH) est un enum filtrable avec les bons tiers", () => {
    const f = resolveField("fiche_confiance");
    expect(f).not.toBeNull();
    expect(f!.type).toBe("enum");
    expect(f!.sql).toBe("e.fiche_confiance");
    // les 3 tiers du réservoir ODH, ni plus ni moins (contrat avec niveau_0.tier)
    // bulk 1 (niveau_0) + bulk 2 (candidats_siren_scored)
    expect(f!.enumValues).toEqual(["fr_dur", "fr_corrobore", "gris_geo", "certain", "haute", "moyenne"]);
    // filtrable par eq/in (pour cibler "fr_dur uniquement" ou "fr_dur+fr_corrobore")
    expect(f!.ops).toContain("eq");
    expect(f!.ops).toContain("in");
  });

  it("web_tier (scoring web ODH) filtre la qualité du site — cible refonte", () => {
    const f = resolveField("web_tier");
    expect(f).not.toBeNull();
    expect(f!.type).toBe("enum");
    expect(f!.sql).toBe("e.web_tier");
    expect(f!.enumValues).toEqual(["moderne", "correct", "vieillissant", "obsolete"]);
    // "obsolete" doit être une valeur valide (le filtre vente de site repose dessus)
    expect(f!.enumValues).toContain("obsolete");
  });

  it("web_is_obsolete est un flag booléen filtrable (eq/exists)", () => {
    const f = resolveField("web_is_obsolete");
    expect(f).not.toBeNull();
    expect(f!.type).toBe("boolean");
    expect(f!.sql).toBe("e.web_is_obsolete");
    expect(f!.ops).toContain("eq");
  });
});
