import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  join(process.cwd(), "prisma/migrations/0033_add_x402_department_covering_index/migration.sql"),
  "utf8",
);

describe("migration 0033_add_x402_department_covering_index", () => {
  it("construit l'index sans bloquer les écritures", () => {
    expect(SQL).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ent_x402_dept_cover");
    expect(SQL).not.toMatch(/CREATE\s+INDEX\s+(?!CONCURRENTLY)/i);
  });

  it("reprend exactement le prédicat public par défaut", () => {
    expect(SQL).toContain("WHERE is_registrar = false");
    expect(SQL).toContain("COALESCE(ca_suspect, false) = false");
  });

  it("couvre le comptage actionnable et les ventilations annoncées", () => {
    expect(SQL).toContain("ON entreprises (departement)");
    for (const column of [
      "best_phone_e164",
      "best_email_normalized",
      "denomination",
      "secteur_final",
      "ecom_level",
      "ecom_platform",
      "web_domain_normalized",
    ]) {
      expect(SQL).toContain(column);
    }
  });
});
