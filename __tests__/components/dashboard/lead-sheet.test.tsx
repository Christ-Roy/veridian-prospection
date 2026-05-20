/**
 * Tests source-level sur src/components/dashboard/lead-sheet.tsx.
 *
 * Anti-régression du cleanup Claude+email himalaya legacy 2026-05-20.
 *
 * Le composant LeadSheet fetchait /api/claude/[domain] et stockait les
 * résultats dans un state `claudeActivities` jamais affiché (commentaire
 * littéral : "fetched for future use but not displayed in current UI").
 * Le cleanup a supprimé le state et le fetch — ces tests verrouillent
 * que personne ne les réintroduit sans recâbler un vrai consumer.
 */
import { describe, expect, test } from "vitest";

describe("lead-sheet.tsx — anti-régression Claude+email cleanup 2026-05-20", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/lead-sheet.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("ne fetch plus /api/claude/[domain]", () => {
    expect(source).not.toMatch(/\/api\/claude\//);
  });

  test("n'a plus de state setClaudeActivities ni claudeActivities", () => {
    expect(source).not.toMatch(/setClaudeActivities/);
    expect(source).not.toMatch(/claudeActivities/);
  });

  test("ne dépend plus du composant ClaudeNotesSection (supprimé de sections.tsx)", () => {
    expect(source).not.toMatch(/ClaudeNotesSection/);
  });
});
