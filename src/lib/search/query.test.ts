import { describe, it, expect } from "vitest";
import { SearchFiltersSchema, buildSearchWhereSql } from "./query";

describe("SearchFiltersSchema — validation", () => {
  it("accepte une condition valide", () => {
    const r = SearchFiltersSchema.safeParse({
      all: [{ field: "chiffre_affaires", op: "between", min: 1000, max: 5000 }],
    });
    expect(r.success).toBe(true);
  });

  it("rejette un champ inconnu (anti-injection par nom de colonne)", () => {
    const r = SearchFiltersSchema.safeParse({
      all: [{ field: "siren; DROP TABLE entreprises;--", op: "eq", value: "x" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejette un opérateur non autorisé sur le type (contains sur booléen)", () => {
    const r = SearchFiltersSchema.safeParse({
      all: [{ field: "est_rge", op: "contains", value: "x" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejette une valeur d'enum invalide", () => {
    const r = SearchFiltersSchema.safeParse({
      all: [{ field: "ca_trend_3y", op: "eq", value: "explosion" }],
    });
    expect(r.success).toBe(false);
  });

  it("accepte une valeur d'enum valide", () => {
    const r = SearchFiltersSchema.safeParse({
      all: [{ field: "ca_trend_3y", op: "eq", value: "growth" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejette 'between' sans min/max", () => {
    const r = SearchFiltersSchema.safeParse({
      all: [{ field: "chiffre_affaires", op: "between", value: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejette 'in' sans values", () => {
    const r = SearchFiltersSchema.safeParse({
      all: [{ field: "departement", op: "in" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejette une requête vide", () => {
    const r = SearchFiltersSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejette un champ supplémentaire inconnu (strict)", () => {
    const r = SearchFiltersSchema.safeParse({
      all: [{ field: "siren", op: "eq", value: "x", evil: 1 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("buildSearchWhereSql — SQL paramétré", () => {
  it("génère du SQL avec placeholders positionnels, valeurs en params", () => {
    const filters = SearchFiltersSchema.parse({
      all: [
        { field: "secteur_final", op: "eq", value: "RESTAURATION" },
        { field: "chiffre_affaires", op: "between", min: 80000, max: 300000 },
      ],
    });
    const { sql, params } = buildSearchWhereSql(filters, 1);
    expect(sql).toContain("e.secteur_final = $1");
    expect(sql).toContain("BETWEEN $2 AND $3");
    expect(params).toEqual(["RESTAURATION", 80000, 300000]);
    // Aucune valeur n'apparaît dans le SQL (tout est paramétré).
    expect(sql).not.toContain("RESTAURATION");
    expect(sql).not.toContain("80000");
  });

  it("traduit 'exists' true/false en IS NOT NULL / IS NULL sans param", () => {
    const f1 = SearchFiltersSchema.parse({ all: [{ field: "web_domain", op: "exists", value: false }] });
    const r1 = buildSearchWhereSql(f1, 1);
    expect(r1.sql).toContain("IS NULL");
    expect(r1.params).toHaveLength(0);

    const f2 = SearchFiltersSchema.parse({ all: [{ field: "phone", op: "exists", value: true }] });
    const r2 = buildSearchWhereSql(f2, 1);
    expect(r2.sql).toContain("IS NOT NULL");
  });

  it("traduit 'in' en IN (...) avec un placeholder par valeur", () => {
    const f = SearchFiltersSchema.parse({
      all: [{ field: "departement", op: "in", values: ["69", "01", "38"] }],
    });
    const { sql, params } = buildSearchWhereSql(f, 1);
    expect(sql).toContain("IN ($1,$2,$3)");
    expect(params).toEqual(["69", "01", "38"]);
  });

  it("'contains' enveloppe la valeur de % et utilise ILIKE", () => {
    const f = SearchFiltersSchema.parse({
      all: [{ field: "denomination", op: "contains", value: "boulang" }],
    });
    const { sql, params } = buildSearchWhereSql(f, 1);
    expect(sql).toContain("ILIKE $1");
    expect(params).toEqual(["%boulang%"]);
  });

  it("combine all (AND) et any (OR) en groupes", () => {
    const f = SearchFiltersSchema.parse({
      all: [{ field: "departement", op: "eq", value: "69" }],
      any: [
        { field: "est_rge", op: "eq", value: true },
        { field: "est_qualiopi", op: "eq", value: true },
      ],
    });
    const { sql } = buildSearchWhereSql(f, 1);
    expect(sql).toMatch(/\(.*=.*\) AND \(.* OR .*\)/);
  });

  it("caste une valeur numérique passée en string vers number (eq)", () => {
    const f = SearchFiltersSchema.parse({
      all: [{ field: "chiffre_affaires", op: "eq", value: "500000" }],
    });
    const { params } = buildSearchWhereSql(f, 1);
    // La string "500000" doit devenir le NOMBRE 500000 dans les params binding.
    expect(params).toEqual([500000]);
    expect(typeof params[0]).toBe("number");
  });

  it("caste les valeurs numériques string dans un 'in'", () => {
    const f = SearchFiltersSchema.parse({
      all: [{ field: "prospect_score", op: "in", values: ["60", "80"] }],
    });
    const { params } = buildSearchWhereSql(f, 1);
    expect(params).toEqual([60, 80]);
    expect(params.every((p) => typeof p === "number")).toBe(true);
  });

  it("laisse une string non-numérique intacte sur un champ texte", () => {
    const f = SearchFiltersSchema.parse({
      all: [{ field: "secteur_final", op: "eq", value: "RESTAURATION" }],
    });
    const { params } = buildSearchWhereSql(f, 1);
    expect(params).toEqual(["RESTAURATION"]);
  });

  it("respecte startIndex pour chaîner les params (pagination après)", () => {
    const f = SearchFiltersSchema.parse({ all: [{ field: "departement", op: "eq", value: "69" }] });
    const { nextIndex } = buildSearchWhereSql(f, 5);
    expect(nextIndex).toBe(6);
  });
});
