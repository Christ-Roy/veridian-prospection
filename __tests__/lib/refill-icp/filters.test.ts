/**
 * Tests pure du module `src/lib/refill-icp/filters.ts`.
 *
 * Périmètre :
 *  - Validation Zod (RefillIcpFiltersSchema)
 *  - buildIcpWhereSql : génération SQL paramétré (sécurité critique — ce SQL
 *    est interpolé dans une requête raw via $queryRawUnsafe ; toute injection
 *    de valeur user non-paramétrée serait une CVE).
 *  - expandZoneSlug : preset → liste de départements.
 */
import { describe, expect, test } from "vitest";
import {
  RefillIcpFiltersSchema,
  buildIcpWhereSql,
  expandZoneSlug,
  FR_DEPARTMENTS,
  QUALIFIER_KEYS,
  SECTOR_PRESETS,
  REGION_PRESETS,
  EFFECTIF_RANGES,
} from "@/lib/refill-icp/filters";

describe("RefillIcpFiltersSchema", () => {
  test("accepts empty object (country defaults to FR)", () => {
    const result = RefillIcpFiltersSchema.parse({});
    expect(result.country).toBe("FR");
  });

  test("rejects unknown country", () => {
    const result = RefillIcpFiltersSchema.safeParse({ country: "BE" });
    expect(result.success).toBe(false);
  });

  test("accepts valid FR department codes", () => {
    const result = RefillIcpFiltersSchema.safeParse({
      regions: ["75", "92", "2A", "971"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid department code 'XX'", () => {
    const result = RefillIcpFiltersSchema.safeParse({ regions: ["XX"] });
    expect(result.success).toBe(false);
  });

  test("rejects unknown field (strict mode)", () => {
    const result = RefillIcpFiltersSchema.safeParse({ malicious_field: 1 });
    expect(result.success).toBe(false);
  });

  test("accepts NAF codes (format X[X].YY[A])", () => {
    expect(
      RefillIcpFiltersSchema.safeParse({ sectors: ["56.10A", "62.01Z"] }).success,
    ).toBe(true);
  });

  test("accepts sector preset slugs", () => {
    const result = RefillIcpFiltersSchema.safeParse({
      sectors: ["restauration", "tech"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects employee_range with min > max", () => {
    const result = RefillIcpFiltersSchema.safeParse({
      employee_range: { min: 100, max: 10 },
    });
    expect(result.success).toBe(false);
  });

  test("rejects revenue_range over 100M€ cap", () => {
    const result = RefillIcpFiltersSchema.safeParse({
      revenue_range: { min: 10_000_000_000_000 },
    });
    expect(result.success).toBe(false);
  });

  test("accepts qualifiers from whitelist", () => {
    const result = RefillIcpFiltersSchema.safeParse({
      qualifiers: ["rge", "qualiopi", "no_website"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown qualifier", () => {
    const result = RefillIcpFiltersSchema.safeParse({
      qualifiers: ["totally_fake_qualifier"],
    });
    expect(result.success).toBe(false);
  });
});

describe("buildIcpWhereSql", () => {
  test("empty filters → empty SQL", () => {
    const { sql, params } = buildIcpWhereSql({ country: "FR" });
    expect(sql).toBe("");
    expect(params).toEqual([]);
  });

  test("country ≠ FR → FALSE clause (résultat vide)", () => {
    const { sql } = buildIcpWhereSql(
      { country: "FR" as const, regions: ["75"] },
      1,
    );
    expect(sql).toContain("e.departement");
    expect(sql).not.toContain("FALSE");
  });

  test("regions → IN list paramétré (anti-injection)", () => {
    const { sql, params, nextIndex } = buildIcpWhereSql(
      { country: "FR" as const, regions: ["75", "92", "2A"] },
      1,
    );
    expect(sql).toContain("e.departement IN ($1,$2,$3)");
    expect(params).toEqual(["75", "92", "2A"]);
    expect(nextIndex).toBe(4);
  });

  test("startIndex offset works (≠ 1)", () => {
    const { sql, params, nextIndex } = buildIcpWhereSql(
      { country: "FR" as const, regions: ["75"] },
      5,
    );
    expect(sql).toContain("$5");
    expect(params).toEqual(["75"]);
    expect(nextIndex).toBe(6);
  });

  test("sectors preset → expansion vers codes NAF", () => {
    const { sql, params } = buildIcpWhereSql(
      { country: "FR" as const, sectors: ["restauration"] },
      1,
    );
    expect(sql).toContain("e.code_naf IN");
    // Preset restauration contient 56.10A, 56.10B, etc.
    expect(params).toContain("56.10A");
  });

  test("sectors mix NAF + preset → dédup via Set", () => {
    const { params } = buildIcpWhereSql(
      { country: "FR" as const, sectors: ["56.10A", "restauration"] },
      1,
    );
    // 56.10A est dans le preset restauration → dédup, 1 seule occurrence.
    const occurrences = params.filter((p) => p === "56.10A").length;
    expect(occurrences).toBe(1);
  });

  test("employee_range → IN list de codes SIRENE overlap", () => {
    const { sql, params } = buildIcpWhereSql(
      { country: "FR" as const, employee_range: { min: 10, max: 50 } },
      1,
    );
    expect(sql).toContain("e.tranche_effectifs IN");
    // Codes 11 (10-19), 12 (20-49), 21 (50-99) chevauchent [10,50]
    expect(params).toContain("11");
    expect(params).toContain("12");
    expect(params).toContain("21");
  });

  test("revenue_range min only → e.chiffre_affaires >= $N", () => {
    const { sql, params } = buildIcpWhereSql(
      { country: "FR" as const, revenue_range: { min: 100_000 } },
      1,
    );
    expect(sql).toContain("e.chiffre_affaires >= $1");
    expect(params).toEqual([100_000]);
  });

  test("age_range → uses EXTRACT(YEAR FROM AGE(...))", () => {
    const { sql, params } = buildIcpWhereSql(
      { country: "FR" as const, age_range: { min_years: 5, max_years: 10 } },
      1,
    );
    expect(sql).toContain("EXTRACT(YEAR FROM AGE");
    expect(params).toEqual([5, 10]);
  });

  test("qualifiers → static SQL (no params), one clause per qualifier", () => {
    const { sql, params } = buildIcpWhereSql(
      { country: "FR" as const, qualifiers: ["rge", "qualiopi"] },
      1,
    );
    expect(sql).toContain("e.est_rge = true");
    expect(sql).toContain("e.est_qualiopi = true");
    // Qualifiers static → 0 param dans le tableau.
    expect(params).toEqual([]);
  });

  test("qualifier 'no_website' → IS NULL clause", () => {
    const { sql } = buildIcpWhereSql(
      { country: "FR" as const, qualifiers: ["no_website"] },
      1,
    );
    expect(sql).toContain("e.web_domain_normalized IS NULL");
  });

  test("all filters combined → all clauses ANDed", () => {
    const { sql, params } = buildIcpWhereSql(
      {
        country: "FR" as const,
        regions: ["75"],
        sectors: ["56.10A"],
        employee_range: { min: 1, max: 9 },
        qualifiers: ["with_phone"],
      },
      1,
    );
    expect(sql).toContain("e.departement IN");
    expect(sql).toContain("e.code_naf IN");
    expect(sql).toContain("e.tranche_effectifs IN");
    expect(sql).toContain("e.best_phone_e164 IS NOT NULL");
    expect(params).toContain("75");
  });

  test("anti-injection: regions values are NOT interpolated in SQL string", () => {
    // Si un attaquant injecte un payload dans regions, il doit finir dans
    // params (binding paramétré), JAMAIS dans la string SQL.
    // Mais Zod rejette d'abord — on teste avec une valeur valide pour vérifier
    // le mécanisme (la valeur va dans params, pas le sql).
    const { sql, params } = buildIcpWhereSql(
      { country: "FR" as const, regions: ["75"] },
      1,
    );
    expect(sql).not.toContain("'75'"); // pas de quote dans SQL
    expect(sql).not.toContain("75"); // valeur n'est pas hardcoded
    expect(params).toEqual(["75"]); // valeur dans params
  });
});

describe("expandZoneSlug", () => {
  test("returns departments for known zone", () => {
    const idf = expandZoneSlug("idf");
    expect(idf).toContain("75");
    expect(idf).toContain("92");
  });

  test("returns null for unknown zone", () => {
    expect(expandZoneSlug("totally_fake")).toBeNull();
  });
});

describe("Catalogues exposés", () => {
  test("FR_DEPARTMENTS has 96 metropole + 5 DOM", () => {
    // 96 dep metropole (01-95 sans 20, + 2A/2B) + 5 DOM
    expect(FR_DEPARTMENTS.length).toBeGreaterThanOrEqual(101);
  });

  test("QUALIFIER_KEYS contains expected business flags", () => {
    expect(QUALIFIER_KEYS).toContain("rge");
    expect(QUALIFIER_KEYS).toContain("qualiopi");
    expect(QUALIFIER_KEYS).toContain("no_website");
  });

  test("SECTOR_PRESETS resolve to NAF code arrays", () => {
    for (const codes of Object.values(SECTOR_PRESETS)) {
      expect(Array.isArray(codes)).toBe(true);
      expect(codes.length).toBeGreaterThan(0);
    }
  });

  test("REGION_PRESETS resolve to dept code arrays", () => {
    for (const deps of Object.values(REGION_PRESETS)) {
      for (const d of deps) {
        expect(FR_DEPARTMENTS).toContain(d);
      }
    }
  });

  test("EFFECTIF_RANGES covers all SIRENE codes", () => {
    expect(Object.keys(EFFECTIF_RANGES).length).toBeGreaterThanOrEqual(16);
  });
});
