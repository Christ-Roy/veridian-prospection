import { vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { describe, it, expect } from "vitest";
import { buildLeadsSelect, buildLeadsFrom, DEFAULT_ENTREPRISES_WHERE } from "./shared";

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

  describe("DEFAULT_ENTREPRISES_WHERE", () => {
    it("excludes registrars and ca_suspect", () => {
      expect(DEFAULT_ENTREPRISES_WHERE).toContain("is_registrar");
      expect(DEFAULT_ENTREPRISES_WHERE).toContain("ca_suspect");
    });
  });
});
