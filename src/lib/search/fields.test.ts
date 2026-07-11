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

  // ─── Segmentation e-commerce (détecteur ODH v13) ───────────────────────────
  it("ecom_level est un enum aux 3 niveaux exacts du détecteur (aucun/catalogue/boutique)", () => {
    const f = resolveField("ecom_level");
    expect(f).not.toBeNull();
    expect(f!.type).toBe("enum");
    expect(f!.sql).toBe("e.ecom_level");
    // contrat strict avec ecom_signals : ni plus, ni moins que ces 3 niveaux.
    expect(f!.enumValues).toEqual(["aucun", "catalogue", "boutique"]);
    // filtrable eq/in pour cibler "boutique" ou "boutique+catalogue".
    expect(f!.ops).toContain("eq");
    expect(f!.ops).toContain("in");
  });

  it("ecom_platform est le champ texte du filtre de FIABILITÉ (plateforme = e-com confirmé)", () => {
    const f = resolveField("ecom_platform");
    expect(f).not.toBeNull();
    expect(f!.type).toBe("text");
    expect(f!.sql).toBe("e.ecom_platform");
    // 'contains'/'in' permettent de cibler une plateforme (woocommerce/shopify…).
    expect(f!.ops).toContain("in");
    expect(f!.ops).toContain("exists"); // exists=true → toutes les boutiques HAUTE CONF
  });

  it("ecom_has_payment est booléen mais reste filtrable (même s'il est sous-détecté)", () => {
    const f = resolveField("ecom_has_payment");
    expect(f).not.toBeNull();
    expect(f!.type).toBe("boolean");
    expect(f!.sql).toBe("e.ecom_has_payment");
  });

  it("ecom_keyword_score est numérique (comparaisons + between)", () => {
    const f = resolveField("ecom_keyword_score");
    expect(f).not.toBeNull();
    expect(f!.type).toBe("number");
    expect(f!.sql).toBe("e.ecom_keyword_score");
    expect(f!.ops).toContain("gte");
    expect(f!.ops).toContain("between");
  });

  it("has_ecommerce legacy pointe toujours sur la colonne buggée web_has_ecommerce (rétro-compat)", () => {
    const f = resolveField("has_ecommerce");
    expect(f).not.toBeNull();
    expect(f!.sql).toBe("e.web_has_ecommerce");
    // le vrai signal fiable est ecom_level/ecom_platform, has_ecommerce reste dispo
    // mais son label doit signaler qu'il est legacy.
    expect(f!.label.toLowerCase()).toContain("legacy");
  });
});
