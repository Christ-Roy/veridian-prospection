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
    // import { ..., History, ... } from "lucide-react"
    expect(source).toMatch(/import\s*\{[^}]*\bHistory\b[^}]*\}\s*from\s*["']lucide-react["']/);
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

describe("lead-sheet.tsx — bouton & modale 'Envoyer un mail' (mail SMTP v1 2026-05-25)", () => {
  // Le bouton est rendu dans la section Emails de la fiche lead, à côté du
  // label "Emails". Au clic, il ouvre ComposeMailDialog pré-rempli avec
  // le premier email trouvé du prospect.
  //
  // Sabotage-test : si on retire l'import ComposeMailDialog ou le state
  // composeMailOpen, ces tests cassent — c'est exactement ce qu'on veut.
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

  test("importe ComposeMailDialog depuis @/components/mail/compose-mail-dialog", () => {
    expect(source).toMatch(
      /import\s*\{\s*ComposeMailDialog\s*\}\s*from\s*["']@\/components\/mail\/compose-mail-dialog["']/,
    );
  });

  test("importe l'icône Mail depuis lucide-react", () => {
    // import { ..., Mail, ... } from "lucide-react"
    expect(source).toMatch(/import\s*\{[^}]*\bMail\b[^}]*\}\s*from\s*["']lucide-react["']/);
  });

  test("détient un state composeMailOpen + composeMailTo pour piloter la modale", () => {
    expect(source).toMatch(/composeMailOpen/);
    expect(source).toMatch(/setComposeMailOpen/);
    expect(source).toMatch(/composeMailTo/);
    expect(source).toMatch(/setComposeMailTo/);
  });

  test("monte <ComposeMailDialog> avec to + prospect + siren", () => {
    expect(source).toMatch(/<ComposeMailDialog\b/);
    expect(source).toMatch(/to=\{composeMailTo\}/);
    expect(source).toMatch(/siren=\{lead\.siren\s*\?\?\s*null\}/);
  });

  test("rend le bouton 'Envoyer un mail' uniquement s'il y a un email disponible", () => {
    // Le pattern `firstEmail && (` empêche l'affichage quand aucun mail
    // n'est dispo — sinon clic bouton avec to="" donnerait un 400.
    expect(source).toMatch(/firstEmail\s*&&\s*\(/);
    expect(source).toContain("Envoyer un mail");
  });
});
