import { vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { describe, it, expect } from "vitest";
import { buildLeadsSelect, buildLeadsFrom, DEFAULT_ENTREPRISES_WHERE, COLUMN_MAP, parseAgeRange, buildAgeDirigeantClause } from "./shared";

describe("shared query helpers", () => {
  describe("buildLeadsSelect", () => {
    it("returns SQL string with SELECT", () => {
      const sql = buildLeadsSelect(null);
      expect(sql).toContain("SELECT");
      expect(sql).toContain("FROM entreprises e");
    });

    it("includes web_domain COALESCE", () => {
      const sql = buildLeadsSelect(null);
      expect(sql).toContain("web_domain");
      expect(sql).toContain("COALESCE");
    });

    it("includes INPI columns when available", () => {
      const sql = buildLeadsSelect(null);
      expect(sql).toContain("ca_trend_3y");
      expect(sql).toContain("profitability_tag");
    });

    it("includes MAX tech_score from web_domains_all", () => {
      const sql = buildLeadsSelect(null);
      expect(sql).toContain("MAX");
      expect(sql).toContain("tech_score");
    });

    it("includes small_biz_score computation", () => {
      const sql = buildLeadsSelect(null);
      expect(sql).toContain("small_biz_score");
    });

    it("uses tenant outreach JOIN when tenantId provided", () => {
      const sql = buildLeadsSelect("test-tenant-123");
      expect(sql).toContain("test-tenant-123");
      expect(sql).toContain("LEFT JOIN outreach");
    });
  });

  describe("buildLeadsFrom", () => {
    it("returns FROM clause with entreprises", () => {
      const sql = buildLeadsFrom(null);
      expect(sql).toContain("FROM entreprises e");
    });
  });

  describe("COLUMN_MAP.age_dirigeant", () => {
    it("is registered as a numeric expression safe for range filtering", () => {
      const expr = COLUMN_MAP.age_dirigeant;
      expect(expr).toBeDefined();
      expect(expr).toContain("dirigeant_annee_naissance");
      expect(expr).toContain("EXTRACT(YEAR FROM CURRENT_DATE)");
      // Must guard against non-numeric values like "[NON-DIFFUSIBLE]"
      expect(expr).toContain("~ '^[0-9]{4}$'");
    });
  });

  describe("parseAgeRange", () => {
    it("parses BETWEEN range", () => {
      expect(parseAgeRange("35-44")).toEqual({ min: 35, max: 44 });
    });
    it("parses >= bound", () => {
      expect(parseAgeRange(">=65")).toEqual({ min: 65, max: null });
    });
    it("parses <= bound", () => {
      expect(parseAgeRange("<=30")).toEqual({ min: null, max: 30 });
    });
    it("parses strict < as max-1", () => {
      expect(parseAgeRange("<35")).toEqual({ min: null, max: 34 });
    });
    it("parses strict > as min+1", () => {
      expect(parseAgeRange(">60")).toEqual({ min: 61, max: null });
    });
    it("rejects garbage", () => {
      expect(parseAgeRange("abc")).toBeNull();
      expect(parseAgeRange("")).toBeNull();
      expect(parseAgeRange("DROP TABLE")).toBeNull();
      expect(parseAgeRange("35-30")).toBeNull(); // min > max
    });
    it("rejects extra whitespace as garbage protection", () => {
      // Should still parse simple whitespace around operators
      expect(parseAgeRange(" >= 65 ")).toEqual({ min: 65, max: null });
    });
  });

  describe("buildAgeDirigeantClause", () => {
    it("returns null for empty list", () => {
      expect(buildAgeDirigeantClause([])).toBeNull();
    });
    it("returns null when only invalid ranges given", () => {
      expect(buildAgeDirigeantClause(["junk", "haha"])).toBeNull();
    });
    it("builds BETWEEN for a single range", () => {
      const sql = buildAgeDirigeantClause(["35-44"]);
      expect(sql).toContain("BETWEEN 35 AND 44");
      expect(sql).toContain("dirigeant_annee_naissance");
    });
    it("ORs multiple ranges in parentheses", () => {
      const sql = buildAgeDirigeantClause(["35-44", ">=65"]);
      expect(sql).toMatch(/^\(.*BETWEEN 35 AND 44.* OR .*>= 65.*\)$/);
    });
    it("ignores invalid ranges mixed with valid ones", () => {
      const sql = buildAgeDirigeantClause(["junk", "35-44"]);
      expect(sql).toContain("BETWEEN 35 AND 44");
      expect(sql).not.toContain("junk");
    });
    it("never injects SQL — only digits get into the clause", () => {
      const sql = buildAgeDirigeantClause(["1; DROP TABLE entreprises;--"]);
      expect(sql).toBeNull();
    });
  });

  describe("DEFAULT_ENTREPRISES_WHERE", () => {
    it("excludes registrars and ca_suspect", () => {
      expect(DEFAULT_ENTREPRISES_WHERE).toContain("is_registrar");
      expect(DEFAULT_ENTREPRISES_WHERE).toContain("ca_suspect");
    });
  });
});
