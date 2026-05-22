/**
 * Tests source-level sur src/components/dashboard/pipeline-board.tsx.
 *
 * Anti-régression du cleanup Claude+email himalaya legacy 2026-05-20.
 *
 * Avant cleanup, le fichier contenait une modale EmailComposeModal qui
 * appelait /api/outreach/[domain]/send (himalaya CLI cassé en prod) +
 * un state setEmailModal jamais déclenché côté UI (composant mort). Le
 * cleanup a supprimé les deux.
 */
import { describe, expect, test } from "vitest";

describe("pipeline-board.tsx — anti-régression Claude+email cleanup 2026-05-20", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/pipeline-board.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("plus de fonction EmailComposeModal", () => {
    expect(source).not.toMatch(/function\s+EmailComposeModal/);
  });

  test("plus de state emailModal / setEmailModal", () => {
    expect(source).not.toMatch(/emailModal/);
    expect(source).not.toMatch(/setEmailModal/);
  });

  test("plus de fetch /api/outreach/.../send", () => {
    expect(source).not.toMatch(/\/api\/outreach\/[^"`']*\/send/);
  });

  test("plus de champ email_count dans le type PipelineLead", () => {
    // Le type local PipelineLead ne doit plus contenir email_count puisque
    // l'API ne le renvoie plus (cleanup pipeline.ts).
    expect(source).not.toMatch(/email_count/);
  });

  test("conserve les imports React/Button toujours utilisés (sanity)", () => {
    expect(source).toMatch(/from\s+"@\/components\/ui\/button"/);
    expect(source).toMatch(/from\s+"@\/components\/ui\/badge"/);
  });
});

describe("pipeline-board.tsx — responsive mobile (sprint UI 2026-05-22)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/pipeline-board.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  // Fix #2 — sur mobile, le board Kanban horizontal est remplacé par un
  // accordéon vertical (8 stades empilés). Régression si le rendu mobile
  // disparaît.
  test("rend une vue accordéon mobile via le composant Accordion", () => {
    expect(source).toMatch(/from\s+"@\/components\/ui\/accordion"/);
  });

  test("dédouble le rendu board horizontal / accordéon par breakpoint md", () => {
    // Le board horizontal est masqué sous md, l'accordéon masqué à partir de md.
    expect(source).toMatch(/md:hidden|hidden md:/);
  });

  // Fix #2 — toutes les tailles de police arbitraires < 12px ont été
  // remplacées par text-xs (12px, minimum lisible du design system).
  test("aucune taille de police arbitraire sous 12px", () => {
    expect(source).not.toMatch(/text-\[(9|10|11)px\]/);
  });
});
