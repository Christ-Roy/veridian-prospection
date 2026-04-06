import { describe, it, expect } from "vitest";

// We can't import buildFilterWhere directly (it's not exported).
// Instead, test the exported ProspectFilters interface + buildQuotaFilter
// which exercises similar logic.
import { buildQuotaFilter, buildFreemiumLeadPoolSQL } from "./lead-quota";

describe("Prospect filters & quota", () => {
  describe("buildQuotaFilter security", () => {
    it("escapes single quotes in department names", () => {
      const result = buildQuotaFilter({
        plan: "freemium",
        maxLeads: 300,
        departments: ["69", "O'Brien"],
        sectors: [],
      });
      expect(result.where).toContain("O''Brien");
      expect(result.where).not.toContain("O'Brien'");
    });

    it("escapes single quotes in sector names", () => {
      const result = buildQuotaFilter({
        plan: "freemium",
        maxLeads: 300,
        departments: [],
        sectors: ["BTP", "IT'; DROP TABLE entreprises; --"],
      });
      expect(result.where).toContain("''");
      // The text 'DROP TABLE' is in the data string but harmless because
      // the quote is escaped: IT''; DROP TABLE... → treated as literal text
      expect(result.where).toContain("IT''");
    });
  });

  describe("freemium pool SQL", () => {
    it("generates CTE with ROW_NUMBER partitioning", () => {
      const sql = buildFreemiumLeadPoolSQL(["69"], ["BTP"], 300);
      expect(sql).toContain("WITH scored_pool AS");
      expect(sql).toContain("ROW_NUMBER() OVER");
      expect(sql).toContain("PARTITION BY");
    });

    it("respects custom limit", () => {
      const sql100 = buildFreemiumLeadPoolSQL([], [], 100);
      expect(sql100).toContain("LIMIT 100");
      const sql500 = buildFreemiumLeadPoolSQL([], [], 500);
      expect(sql500).toContain("LIMIT 500");
    });

    it("applies score floor >= 25", () => {
      const sql = buildFreemiumLeadPoolSQL([], [], 300);
      expect(sql).toContain("prospect_score >= 25");
    });

    it("includes is_registrar and ca_suspect guards", () => {
      const sql = buildFreemiumLeadPoolSQL([], [], 300);
      expect(sql).toContain("is_registrar = false");
      expect(sql).toContain("ca_suspect");
    });
  });
});

export {};
