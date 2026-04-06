import { describe, it, expect } from "vitest";
import { formatCA, formatEffectifs, formatTimeAgo } from "./types";

describe("formatCA", () => {
  it("returns - for null", () => expect(formatCA(null)).toBe("-"));
  it("formats millions", () => expect(formatCA(2500000)).toBe("2.5M€"));
  it("formats thousands", () => expect(formatCA(450000)).toBe("450K€"));
  it("formats small amounts", () => expect(formatCA(999)).toContain("€"));
  it("handles zero", () => expect(formatCA(0)).toContain("€"));
});

describe("formatEffectifs", () => {
  it("returns - for null", () => expect(formatEffectifs(null)).toBe("-"));
  it("returns - for empty", () => expect(formatEffectifs("")).toBe("-"));
  it("maps known codes", () => {
    expect(formatEffectifs("01")).not.toBe("01"); // Should map to label
    expect(formatEffectifs("11")).not.toBe("-");
  });
  it("returns raw code for unknown", () => expect(formatEffectifs("ZZ")).toBe("ZZ"));
});

describe("formatTimeAgo", () => {
  it("returns null for null input", () => expect(formatTimeAgo(null)).toBeNull());
  it("returns string for recent date", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const result = formatTimeAgo(yesterday);
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});

export {};
