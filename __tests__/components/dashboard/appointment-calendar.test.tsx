/**
 * Tests source-level sur src/components/dashboard/appointment-calendar.tsx.
 *
 * Sprint UI calendrier RDV 2026-05-22 : refonte complète.
 *  - palette extraite dans `lib/appointment-colors` (cohérence cross-vue)
 *  - vue listWeek imposée sous md (FullCalendar lisible sur 375px)
 *  - theming OKLCH via variables CSS `var(--fc-appt-*)` au lieu de
 *    couleurs hex hardcodées
 *  - toolbar simplifiée en mobile (prev/next/today, pas de sélecteur de vue)
 *  - rendu custom des événements
 *
 * Pattern source-level (cf pipeline-board.test.tsx).
 *
 * Régression à attraper :
 *  - retour des couleurs hex hardcodées (perd la cohérence theming OKLCH)
 *  - perte de l'extraction palette via `appointment-colors`
 *  - retour à `initialView="timeGridWeek"` unique (casse le rendu mobile)
 *  - le plugin `list` est retiré (vue listWeek HS)
 */
import { describe, expect, test } from "vitest";

describe("appointment-calendar.tsx — refonte UI calendrier (sprint 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/appointment-calendar.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // ─── Palette extraite ────────────────────────────────────────────────
  test("consomme la palette via `appointmentPalette` (lib/appointment-colors)", () => {
    expect(source).toMatch(
      /import\s+\{\s*appointmentPalette\s*\}\s+from\s+"@\/lib\/appointment-colors"/,
    );
    expect(source).toMatch(/appointmentPalette\(/);
  });

  test("ne déclare plus de table de couleurs locale `STAGE_COLORS`", () => {
    // La table hex hardcodée a été déplacée vers lib/appointment-colors
    // pour partager le contrat avec upcoming-appointments. Si quelqu'un
    // la re-rajoute en local, on perd la cohérence cross-vue.
    expect(source).not.toMatch(/const\s+STAGE_COLORS\s*[:=]/);
  });

  test("ne contient plus de couleurs hex hardcodées pour les RDV", () => {
    // Les couleurs amber/violet/sky des RDV (#fef3c7 / #ede9fe / #dbeafe etc.)
    // sont maintenant des variables CSS OKLCH.
    expect(source).not.toMatch(/#fef3c7|#f59e0b|#ede9fe|#8b5cf6|#dbeafe|#3b82f6/);
  });

  test("utilise les variables CSS `fcVar` / `fcBorderVar` de la palette", () => {
    expect(source).toMatch(/palette\.fcVar/);
    expect(source).toMatch(/palette\.fcBorderVar/);
  });

  // ─── Vue listWeek mobile ─────────────────────────────────────────────
  test("importe le plugin `@fullcalendar/list` (vue listWeek mobile)", () => {
    expect(source).toMatch(/import\s+listPlugin\s+from\s+"@fullcalendar\/list"/);
  });

  test("consomme `useMediaQuery` pour basculer la vue selon le viewport", () => {
    expect(source).toMatch(/import\s+\{\s*useMediaQuery\s*\}\s+from\s+"@\/hooks\/use-media-query"/);
    expect(source).toMatch(/useMediaQuery\("\(min-width:\s*768px\)"\)/);
  });

  test("bascule sur `listWeek` quand isDesktop=false (effet de resize)", () => {
    // Si quelqu'un retire la bascule, la vue mobile redevient timeGridWeek
    // qui déborde l'écran sur 375px.
    expect(source).toMatch(/listWeek/);
    expect(source).toMatch(/api\.changeView/);
  });

  // ─── Toolbar mobile simplifiée ───────────────────────────────────────
  test("toolbar mobile sans sélecteur de vue (right: 'today')", () => {
    // En mobile, le sélecteur de vue (Mois/Semaine/Jour) est superflu
    // car la vue listWeek est imposée.
    expect(source).toMatch(/isDesktop\s*===\s*false/);
  });

  // ─── Theming centralisé ──────────────────────────────────────────────
  test("expose la classe `fc-veridian` (hook pour theming globals.css)", () => {
    // Toutes les règles OKLCH des RDV sont scoppées sous `.fc-veridian`
    // dans globals.css pour ne pas polluer le reste du DOM.
    expect(source).toMatch(/fc-veridian/);
  });

  test("conserve l'export AppointmentCalendar (sanity)", () => {
    expect(source).toMatch(/export function AppointmentCalendar/);
  });
});
