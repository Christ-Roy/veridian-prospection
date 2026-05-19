import { describe, it, expect } from "vitest";
import { formatCA, formatEffectifs, formatTimeAgo, getStatusInfo } from "./types";

describe("getStatusInfo — extension 2026-05-20 (toutes valeurs status reconnues)", () => {
  it("reconnaît les stages canoniques pipeline", () => {
    expect(getStatusInfo("fiche_ouverte").label).toBe("Fiche ouverte");
    expect(getStatusInfo("repondeur").label).toBe("Repondeur");
    expect(getStatusInfo("a_rappeler").label).toBe("A rappeler");
    expect(getStatusInfo("site_demo").label).toBe("Site demo");
    expect(getStatusInfo("acompte").label).toBe("Acompte");
    expect(getStatusInfo("client").label).toBe("Client");
    expect(getStatusInfo("upsell").label).toBe("Upsell");
  });

  it("reconnaît les terminaux", () => {
    expect(getStatusInfo("archive").label).toBe("Archive");
    expect(getStatusInfo("pas_interesse").label).toBe("Pas interesse");
    expect(getStatusInfo("hors_cible").label).toBe("Hors cible");
  });

  it("reconnaît les status legacy (skip, qualified, etc.)", () => {
    // Avant l'extension, skip/qualified tombaient en fallback 'a_contacter'
    // → affichage "A contacter" pour des leads archivés/qualifiés. Bug.
    expect(getStatusInfo("skip").label).toBe("Skip");
    expect(getStatusInfo("qualified").label).toBe("Qualifie");
    expect(getStatusInfo("disqualifie").label).toBe("Disqualifie");
    expect(getStatusInfo("contacte").label).toBe("Contacte");
    expect(getStatusInfo("en_observation").label).toBe("En observation");
  });

  it("fallback safe pour valeur inconnue", () => {
    expect(getStatusInfo("xyz_inexistant").label).toBe("A contacter");
  });
});

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
