import { vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { describe, it, expect } from "vitest";
import { buildFilterWhere } from "./prospects";

describe("buildFilterWhere — mobileOnly", () => {
  it("classifies mobile via e164 prefix +336/+337 (NOT best_phone_type='mobile')", () => {
    // Why this test exists: best_phone_type used to mean line nature
    // (mobile/fixe), but the column is now repurposed as the enrichment
    // source ('overture', 'osm', 'staging_recovered'). The previous filter
    // `best_phone_type = 'mobile'` always returned 0 rows in prod. The
    // canonical mobile detection is the e164 prefix on the phone column.
    const { sql } = buildFilterWhere({ mobileOnly: true });
    expect(sql).toContain("best_phone_e164");
    expect(sql).toContain("33[67]");
    // Crucial regression guard — never reintroduce the broken comparison.
    expect(sql).not.toContain("best_phone_type = 'mobile'");
  });

  it("combines mobileOnly with hasWebsite='without' as AND clauses", () => {
    const { sql } = buildFilterWhere({
      mobileOnly: true,
      hasWebsite: "without",
    });
    // Both clauses present, joined with AND.
    expect(sql).toContain("best_phone_e164");
    expect(sql).toContain("web_domain_normalized IS NULL");
    expect(sql.split(" AND ").length).toBeGreaterThanOrEqual(2);
  });

  it("does not add a mobile clause when mobileOnly is false", () => {
    const { sql } = buildFilterWhere({ mobileOnly: false });
    expect(sql).not.toContain("33[67]");
  });
});

describe("buildFilterWhere — hasWebsite toggle", () => {
  it("with → web_domain present", () => {
    const { sql } = buildFilterWhere({ hasWebsite: "with" });
    expect(sql).toContain("web_domain_normalized IS NOT NULL");
  });
  it("without → web_domain absent", () => {
    const { sql } = buildFilterWhere({ hasWebsite: "without" });
    expect(sql).toContain("web_domain_normalized IS NULL");
    expect(sql).toContain("web_domain IS NULL");
  });
});
