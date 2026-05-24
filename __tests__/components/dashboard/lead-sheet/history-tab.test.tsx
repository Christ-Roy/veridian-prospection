/**
 * Tests source-level sur src/components/dashboard/lead-sheet/history-tab.tsx.
 *
 * Phase 1 fiche historique 360° — verrouille l'invariant front :
 *  - 3 types attendus (transitions + followups + appointments) — pas plus,
 *    pas moins ; Phase 2-4 viendront étendre explicitement le set.
 *  - Filtres par type ET filtre date sont câblés dans l'UI.
 *  - L'endpoint appelé est bien /api/leads/[siren]/timeline (pas /history qui
 *    sert l'historique INPI financier — confusion de naming évitée).
 */
import { describe, expect, test } from "vitest";

describe("lead-sheet/history-tab.tsx — squelette Phase 1", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(
        process.cwd(),
        "src/components/dashboard/lead-sheet/history-tab.tsx",
      ),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("exporte HistoryTab (sanity)", () => {
    expect(source).toMatch(/export function HistoryTab/);
  });

  test("appelle bien l'endpoint /api/leads/[siren]/timeline", () => {
    expect(source).toMatch(/\/api\/leads\/\$\{encodeURIComponent\(siren\)\}\/timeline/);
  });

  test("traite les 3 types Phase 1 (pipeline_transition, followup, appointment)", () => {
    expect(source).toMatch(/"pipeline_transition"/);
    expect(source).toMatch(/"followup"/);
    expect(source).toMatch(/"appointment"/);
  });

  test("filtres par type câblés (toggleType)", () => {
    expect(source).toMatch(/toggleType/);
    expect(source).toMatch(/enabledTypes\.has/);
  });

  test("filtres date (since via DATE_RANGES + searchParams)", () => {
    expect(source).toMatch(/DATE_RANGES/);
    expect(source).toMatch(/searchParams\.set\("since"/);
  });

  test("guard r.ok avant .json() — anti bug-intermittent setEvents", () => {
    // Pattern source-level cf stats-cards.test.tsx : un fetch sans guard
    // r.ok peut setter un body d'erreur dans events[] et casser le map.
    expect(source).toMatch(/if\s*\(!r\.ok\)/);
  });

  test("fetch a un .catch (pas d'unhandledrejection)", () => {
    expect(source).toMatch(/\.catch\(/);
  });

  test("data-testid pour mega battery E2E", () => {
    expect(source).toMatch(/data-testid="history-timeline"/);
    expect(source).toMatch(/data-testid="history-empty"/);
    expect(source).toMatch(/data-testid=`history-event-/);
  });
});
