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
