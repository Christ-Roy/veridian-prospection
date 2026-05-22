/**
 * Tests source-level sur src/components/dashboard/calendar-dialog.tsx.
 *
 * Sprint UI calendrier RDV 2026-05-22 : la dialog utilisait des `<label>`
 * HTML bruts sans `htmlFor` ni id sur les inputs cibles — pas de
 * focus-on-click, lecteurs d'écran ne lient pas label↔input, et bug a11y
 * `Form Label is not associated with its control` (Axe).
 *
 * Refonte : tous les `<label>` deviennent `<Label htmlFor=...>` shadcn
 * avec id correspondant sur le contrôle. Accents français rétablis
 * (Créer, Durée, sélectionner).
 *
 * Pattern source-level (cf pipeline-board.test.tsx).
 *
 * Régression à attraper :
 *  - retour des `<label>` HTML sans `htmlFor`
 *  - perte des id sur les Select/Trigger/Textarea (label orphelin)
 *  - retour des chaînes sans accent (Creer, Duree, selectionner)
 */
import { describe, expect, test } from "vitest";

describe("calendar-dialog.tsx — a11y labels + accents (sprint 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/calendar-dialog.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // ─── A11y : Label shadcn obligatoire ─────────────────────────────────
  test("importe `Label` depuis @/components/ui/label", () => {
    expect(source).toMatch(/import\s+\{\s*Label\s*\}\s+from\s+"@\/components\/ui\/label"/);
  });

  test("plus de `<label className=\"text-sm font-medium\">` HTML brut (pattern legacy)", () => {
    // L'ancien pattern produit un label visuel non-lié au contrôle.
    expect(source).not.toMatch(/<label\s+className="text-sm font-medium"/);
  });

  test("Date / Heure / Durée / Notes ont chacun un `<Label htmlFor=...>`", () => {
    expect(source).toMatch(/<Label\s+htmlFor="calendar-date-trigger">/);
    expect(source).toMatch(/<Label\s+htmlFor="calendar-time"/);
    expect(source).toMatch(/<Label\s+htmlFor="calendar-duration">/);
    expect(source).toMatch(/<Label\s+htmlFor="calendar-notes">/);
  });

  test("les contrôles ciblés ont l'id correspondant", () => {
    // Date trigger
    expect(source).toMatch(/id="calendar-date-trigger"/);
    // Time SelectTrigger
    expect(source).toMatch(/<SelectTrigger\s+id="calendar-time"/);
    // Duration SelectTrigger
    expect(source).toMatch(/<SelectTrigger\s+id="calendar-duration"/);
    // Notes Textarea
    expect(source).toMatch(/<Textarea[\s\S]*?id="calendar-notes"/);
  });

  // ─── Accents français — la base est française, plus de Creer / Duree ─
  test("plus de chaînes sans accent dans les libellés FR", () => {
    expect(source).not.toMatch(/"Veuillez selectionner une date"/);
    expect(source).not.toMatch(/"Creer le rappel"/);
    expect(source).not.toMatch(/"Creer le RDV"/);
    expect(source).not.toMatch(/text-sm font-medium">Duree/);
  });

  test("les libellés FR sont accentués (Créer, Durée, sélectionner)", () => {
    expect(source).toMatch(/sélectionner une date/);
    expect(source).toMatch(/Créer le rappel/);
    expect(source).toMatch(/Créer le RDV/);
    expect(source).toMatch(/>Durée<\/Label>/);
  });

  test("conserve l'export CalendarDialog (sanity)", () => {
    expect(source).toMatch(/export function CalendarDialog/);
  });
});
