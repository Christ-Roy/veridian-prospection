/**
 * Tests source-level sur src/components/dashboard/pipeline-view.tsx.
 *
 * Sprint perf 2026-05-22 : `/pipeline` chargeait FullCalendar (~5 packages
 * @fullcalendar/*) dans le bundle initial même quand l'utilisateur restait
 * sur la vue liste. Refonte : `AppointmentCalendar` est sorti via
 * `next/dynamic` + `ssr: false`. Le chunk ne charge qu'au clic sur le
 * toggle "Calendrier".
 *
 * Pattern source-level (cf pipeline-board.test.tsx) : on vérifie les
 * invariants du code-split. Régression silencieuse si quelqu'un re-importe
 * AppointmentCalendar en statique.
 */
import { describe, expect, test } from "vitest";

describe("pipeline-view.tsx — code-split FullCalendar (sprint perf 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/pipeline-view.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("AppointmentCalendar est importé via next/dynamic", () => {
    expect(source).toMatch(/import\s+dynamic\s+from\s+"next\/dynamic"/);
    expect(source).toMatch(
      /const\s+AppointmentCalendar\s*=\s*dynamic\s*\(/,
    );
  });

  test("aucun import statique de AppointmentCalendar (sinon le code-split casse)", () => {
    // L'ancien pattern : `import { AppointmentCalendar } from "@/components/dashboard/appointment-calendar"`
    // ramène les 5 packages @fullcalendar/* dans le bundle initial.
    expect(source).not.toMatch(
      /^import\s+\{[^}]*AppointmentCalendar[^}]*\}\s+from\s+["'][^"']*appointment-calendar["']/m,
    );
  });

  test("AppointmentCalendar monté en `ssr: false` (FullCalendar = client-only)", () => {
    expect(source).toMatch(/ssr:\s*false/);
  });

  test("expose un fallback de chargement (Loader2 spinner)", () => {
    // UX : pendant le chunk download le toggle "Calendrier" doit montrer
    // un loader plutôt qu'un écran blanc.
    expect(source).toMatch(/loading:\s*\(\)\s*=>/);
    expect(source).toMatch(/Loader2/);
  });

  test("conserve l'export PipelineView (sanity)", () => {
    expect(source).toMatch(/export function PipelineView/);
  });
});
