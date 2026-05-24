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

describe("lead-sheet.tsx — badge état pipeline dynamique (2026-05-23)", () => {
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

  // Le badge "État pipeline" affichait le stage via une recherche dans
  // PIPELINE_STAGES hardcodé — il manquait les stages custom des workspaces
  // qui en ont. Refonte : findStageOrFallback(workspaceStages, slug) qui
  // tolère les slugs custom + fallback legacy si slug disparu.
  test("résout le stage du lead via findStageOrFallback (pas PIPELINE_STAGES.find)", () => {
    expect(source).toContain("findStageOrFallback(workspaceStages");
    expect(source).not.toMatch(/PIPELINE_STAGES\s*\.\s*find/);
  });

  test("importe le hook + helper depuis use-pipeline-stages (sabotage : autre source = rouge)", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*useWorkspacePipelineStages[^}]*findStageOrFallback[^}]*\}\s*from\s*["']@\/hooks\/use-pipeline-stages["']/,
    );
  });
});

describe("lead-sheet.tsx — intégration onglet Historique 360° Phase 1 (2026-05-24)", () => {
  // L'onglet Historique est ajouté à la liste d'AccordionItem de la fiche.
  // Si le composant HistoryTab est retiré ou que l'AccordionItem disparaît,
  // la fiche perd son fil chronologique sans bruit. Ces invariants
  // bloquent la régression silencieuse.
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

  test("importe HistoryTab depuis lead-sheet/history-tab", () => {
    expect(source).toMatch(
      /import\s*\{\s*HistoryTab\s*\}\s*from\s*["']\.\/lead-sheet\/history-tab["']/,
    );
  });

  test("importe l'icône History depuis lucide-react", () => {
    expect(source).toMatch(/from\s+["']lucide-react["'][^;]*\bHistory\b/);
  });

  test("rend un AccordionItem value=\"history\" qui monte HistoryTab", () => {
    // Sabotage : si on retire l'AccordionItem ou qu'on coupe le siren prop,
    // ce test casse — c'est exactement ce qu'on veut.
    expect(source).toMatch(/AccordionItem\s+value="history"/);
    expect(source).toMatch(/<HistoryTab\s+siren=\{lead\.siren\}\s*\/>/);
  });

  test("monte l'onglet uniquement si lead.siren présent (pas de fiche sans SIREN valide)", () => {
    // La timeline est SIREN-centric (cf endpoint /api/leads/[siren]/timeline).
    // Tenter de la rendre sans SIREN = fetch 400. Le gating `lead.siren &&`
    // évite l'affichage prématuré pendant le loading initial.
    expect(source).toMatch(/\{lead\.siren\s*&&\s*\(\s*\n?\s*<AccordionItem\s+value="history"/);
  });
});
