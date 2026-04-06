/**
 * Unit tests for src/lib/twenty.ts — resolveSirensToWebDomains.
 *
 * Mock @/lib/prisma via vi.mock so no real DB is needed. Only tests the
 * SIREN → web_domain resolution logic added in commit 9ed5c0d, which was
 * the fix for the twenty.getQualifications bug post-SIREN refactor.
 *
 * Run: npx vitest run src/lib/twenty.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock prisma BEFORE importing twenty.ts (dynamic import inside the module)
const mockQueryRawUnsafe = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: mockQueryRawUnsafe,
  },
}));

// Import after mock is installed
import { resolveSirensToWebDomains } from "./twenty";

describe("resolveSirensToWebDomains", () => {
  beforeEach(() => {
    mockQueryRawUnsafe.mockReset();
  });

  it("returns an empty Map when input is empty (no DB call)", async () => {
    const result = await resolveSirensToWebDomains([]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    // Important: the helper should short-circuit WITHOUT hitting the DB
    expect(mockQueryRawUnsafe).not.toHaveBeenCalled();
  });

  it("maps SIREN → web_domain for rows returned by Prisma", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([
      { siren: "439076563", web_domain: "pollen-scop.fr" },
      { siren: "123456789", web_domain: "example.fr" },
      { siren: "987654321", web_domain: "another-company.com" },
    ]);

    const result = await resolveSirensToWebDomains([
      "439076563",
      "123456789",
      "987654321",
    ]);

    expect(result.size).toBe(3);
    expect(result.get("439076563")).toBe("pollen-scop.fr");
    expect(result.get("123456789")).toBe("example.fr");
    expect(result.get("987654321")).toBe("another-company.com");

    expect(mockQueryRawUnsafe).toHaveBeenCalledOnce();
    const [sql, sirenArray] = mockQueryRawUnsafe.mock.calls[0];
    expect(sql).toContain("FROM entreprises");
    expect(sql).toContain("web_domain_normalized as web_domain");
    expect(sql).toContain("web_domain_normalized IS NOT NULL");
    expect(sirenArray).toEqual(["439076563", "123456789", "987654321"]);
  });

  it("filters out rows with null web_domain (defensive)", async () => {
    // Prisma's WHERE already filters these, but the helper also defends
    // against null in the mapping loop.
    mockQueryRawUnsafe.mockResolvedValueOnce([
      { siren: "111111111", web_domain: "real-site.fr" },
      { siren: "222222222", web_domain: null },
      { siren: "333333333", web_domain: "another.com" },
    ]);

    const result = await resolveSirensToWebDomains([
      "111111111",
      "222222222",
      "333333333",
    ]);

    expect(result.size).toBe(2);
    expect(result.get("111111111")).toBe("real-site.fr");
    expect(result.get("222222222")).toBeUndefined();
    expect(result.get("333333333")).toBe("another.com");
  });

  it("returns an empty Map when no rows match (SIREN not in entreprises)", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);
    const result = await resolveSirensToWebDomains(["000000000"]);
    expect(result.size).toBe(0);
    expect(mockQueryRawUnsafe).toHaveBeenCalledOnce();
  });

  it("passes the siren list as a single parameter array (batch query)", async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);
    const sirens = ["111", "222", "333", "444", "555"];
    await resolveSirensToWebDomains(sirens);

    expect(mockQueryRawUnsafe).toHaveBeenCalledOnce();
    const [, paramArray] = mockQueryRawUnsafe.mock.calls[0];
    // ANY($1::text[]) — we should pass the whole array as ONE param, not spread
    expect(paramArray).toEqual(sirens);
  });

  it("propagates Prisma errors (does not swallow)", async () => {
    mockQueryRawUnsafe.mockRejectedValueOnce(new Error("connection refused"));
    await expect(resolveSirensToWebDomains(["111"])).rejects.toThrow(
      "connection refused",
    );
  });
});
