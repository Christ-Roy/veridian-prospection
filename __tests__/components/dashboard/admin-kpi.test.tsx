/**
 * Tests source-level sur src/components/dashboard/admin-kpi.tsx.
 *
 * Audit trial résidus 2026-05-24 — la page KPI admin (Plan & Quota)
 * affichait "300 leads max" + "Essai gratuit" pour des plans payants
 * (business, lifetime_*, internal, starter). Promesse Robert "client paie
 * = aucun bandeau visible" violée même sur la page admin interne.
 *
 * Pattern source-level pour minimiser le coût de maintenance (cf
 * `pipeline-board.test.tsx`).
 */
import { describe, expect, test } from "vitest";

describe("admin-kpi.tsx — sub plan reconnaît tous les paliers payants", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/admin-kpi.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Avant le fix : seul `enterprise` → "Acces illimite". `business`,
  // `lifetime_*`, `internal` tombaient dans `else: "300 leads max"`.
  test("business → 'Acces illimite' (pas '300 leads max')", () => {
    expect(source).toMatch(/trialData\?\.plan === "business"/);
    // La présence du label "Acces illimite" doit accompagner business.
    const businessBlock = source.match(/business[\s\S]{0,400}/);
    expect(businessBlock).not.toBeNull();
    expect(businessBlock![0]).toMatch(/Acces illimite/);
  });

  test("lifetime_site_vitrine → 'Acces illimite'", () => {
    expect(source).toMatch(/lifetime_site_vitrine/);
  });

  test("lifetime_partner → 'Acces illimite'", () => {
    expect(source).toMatch(/lifetime_partner/);
  });

  test("internal → 'Acces illimite'", () => {
    expect(source).toMatch(/trialData\?\.plan === "internal"/);
  });

  test("starter → '5 000 leads' (pas '300 leads max')", () => {
    expect(source).toMatch(/trialData\?\.plan === "starter"/);
    expect(source).toMatch(/5 000 leads/);
  });

  // Champ "Jours restants" : daysLeft=999 (plan payant) doit afficher "—"
  // + sub "Illimite", pas "999" + "Essai gratuit".
  test("daysLeft >= 900 affiche '—' au lieu de '999'", () => {
    expect(source).toMatch(/trialData\.daysLeft\s*>=\s*900/);
  });

  test("daysLeft >= 900 affiche 'Illimite' (pas 'Essai gratuit')", () => {
    // Le sub doit varier : "Illimite" si daysLeft >= 900, sinon
    // "Essai gratuit". Sabotage : retirer cette branche rétablit le bug.
    const subBlock = source.match(/daysLeft >= 900[\s\S]{0,200}Illimite/);
    expect(subBlock).not.toBeNull();
  });
});
