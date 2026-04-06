import { describe, it, expect } from "vitest";
import { buildQuotaFilter, buildFreemiumLeadPoolSQL } from "./lead-quota";

describe("Lead quota system", () => {
  describe("buildQuotaFilter", () => {
    it("freemium: returns score≥25 + dept filter + limit 300", () => {
      const result = buildQuotaFilter({
        plan: "freemium",
        maxLeads: 300,
        departments: ["69", "42"],
        sectors: ["BTP"],
      });
      expect(result.limit).toBe(300);
      expect(result.where).toContain("prospect_score >= 25");
      expect(result.where).toContain("departement IN");
      expect(result.where).toContain("'69'");
      expect(result.where).toContain("secteur_final IN");
    });

    it("geo: returns dept filter + no limit", () => {
      const result = buildQuotaFilter({
        plan: "geo",
        maxLeads: null,
        departments: ["69", "42", "01"],
        sectors: [],
      });
      expect(result.limit).toBeNull();
      expect(result.where).toContain("departement IN");
      expect(result.where).not.toContain("prospect_score");
    });

    it("full/enterprise: returns no filter + no limit", () => {
      for (const plan of ["full", "enterprise"] as const) {
        const result = buildQuotaFilter({
          plan,
          maxLeads: null,
          departments: [],
          sectors: [],
        });
        expect(result.limit).toBeNull();
        expect(result.where).toBe("1=1");
      }
    });

    it("freemium with no dept/sector: returns only score filter", () => {
      const result = buildQuotaFilter({
        plan: "freemium",
        maxLeads: 300,
        departments: [],
        sectors: [],
      });
      expect(result.limit).toBe(300);
      expect(result.where).toContain("prospect_score >= 25");
      expect(result.where).not.toContain("departement");
    });
  });

  describe("buildFreemiumLeadPoolSQL", () => {
    it("generates valid SQL with CTE and LIMIT", () => {
      const sql = buildFreemiumLeadPoolSQL(["69"], ["BTP"], 300);
      expect(sql).toContain("WITH scored_pool AS");
      expect(sql).toContain("LIMIT 300");
      expect(sql).toContain("ROW_NUMBER()");
      expect(sql).toContain("PARTITION BY");
      expect(sql).toContain("departement IN ('69')");
      expect(sql).toContain("secteur_final IN ('BTP')");
    });

    it("escapes single quotes in inputs", () => {
      const sql = buildFreemiumLeadPoolSQL(["69"], ["O'Brien"], 100);
      expect(sql).toContain("O''Brien");
    });
  });
});
