/**
 * Tests source-level sur src/components/dashboard/upcoming-appointments.tsx.
 *
 * Sprint UI calendrier RDV 2026-05-22 : la liste latérale des prochains
 * RDV utilisait sa propre palette (couleurs amber/purple/blue hardcodées
 * via classes Tailwind). Refonte : on consomme `appointmentPalette` /
 * `resolveStageKey` depuis `lib/appointment-colors` pour partager le
 * contrat avec `appointment-calendar.tsx`.
 *
 * Pattern source-level (cf pipeline-board.test.tsx).
 *
 * Régression à attraper :
 *  - retour des palettes locales hardcodées (perd la cohérence visuelle
 *    avec le calendrier)
 *  - le badge "Prochains RDV" reste sur la palette `bg-blue-100` au lieu
 *    de la couleur primary du design system
 */
import { describe, expect, test } from "vitest";

describe("upcoming-appointments.tsx — refonte palette partagée (sprint 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/upcoming-appointments.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("consomme `appointmentPalette` et `resolveStageKey` depuis lib", () => {
    expect(source).toMatch(
      /import\s+\{\s*appointmentPalette,\s*resolveStageKey\s*\}\s+from\s+"@\/lib\/appointment-colors"/,
    );
    expect(source).toMatch(/appointmentPalette\(/);
    expect(source).toMatch(/resolveStageKey\(/);
  });

  test("ne redéfinit plus localement les classes Tailwind par stage", () => {
    // L'ancien stageColor ramenait des chaînes hardcodées (border-amber-200 / etc.)
    // → maintenant délégué à la palette. Le retour de ces chaînes en dur
    // signifierait une duplication.
    expect(source).not.toMatch(/return "border-amber-200 bg-amber-50/);
    expect(source).not.toMatch(/return "border-purple-200 bg-purple-50/);
  });

  test("`stageColor` est une délégation simple à `appointmentPalette(stage).surface`", () => {
    expect(source).toMatch(/return appointmentPalette\(stage\)\.surface/);
  });

  // ─── Badge "Prochains RDV" — passe au primary du design system ───────
  test("le badge nombre RDV utilise `bg-primary/10 ... text-primary` (pas bleu hardcodé)", () => {
    expect(source).toMatch(/bg-primary\/10/);
    expect(source).toMatch(/text-primary/);
    expect(source).not.toMatch(/bg-blue-100 dark:bg-blue-900/);
  });

  test("conserve l'export UpcomingAppointments (sanity)", () => {
    expect(source).toMatch(/export function UpcomingAppointments/);
  });
});
