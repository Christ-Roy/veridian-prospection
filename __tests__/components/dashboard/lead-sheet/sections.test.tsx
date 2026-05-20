/**
 * Tests source-level sur src/components/dashboard/lead-sheet/sections.tsx.
 *
 * Anti-régression du cleanup Claude+email himalaya legacy 2026-05-20.
 *
 * Avant cleanup, le fichier exportait ClaudeNotesSection + ClaudeActivityCard
 * (cartes d'activité Claude avec bouton "Modifier draft" + "Envoyer email"
 * qui appelaient /api/claude/[id] PUT et /api/outreach/[domain]/send POST).
 * Ces routes ont été supprimées + la table outreach_emails n'a plus de
 * writer. La UI Claude/email manuelle est donc morte ; ces tests verrouillent
 * sa non-réintroduction.
 *
 * Pas de test fonctionnel (render Testing Library) ici — le fichier expose
 * 15+ sections React pures dont la couverture pleine demanderait un harnais
 * dédié. Cette suite garantit le strict minimum : le sous-périmètre Claude
 * reste bien retiré.
 */
import { describe, expect, test } from "vitest";

describe("lead-sheet/sections.tsx — anti-régression Claude+email cleanup 2026-05-20", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/lead-sheet/sections.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("plus d'export ClaudeNotesSection", () => {
    expect(source).not.toMatch(/export\s+function\s+ClaudeNotesSection/);
  });

  test("plus de fonction ClaudeActivityCard interne", () => {
    expect(source).not.toMatch(/function\s+ClaudeActivityCard/);
  });

  test("plus de fetch /api/claude/ ni /api/outreach/.../send", () => {
    expect(source).not.toMatch(/\/api\/claude\//);
    expect(source).not.toMatch(/\/api\/outreach\/[^"`']*\/send/);
  });

  test("plus d'import CLAUDE_ACTIVITY_COLORS / LABELS / ClaudeActivity / ClaudeActivityType", () => {
    expect(source).not.toMatch(/CLAUDE_ACTIVITY_COLORS/);
    expect(source).not.toMatch(/CLAUDE_ACTIVITY_LABELS/);
    expect(source).not.toMatch(/\bClaudeActivity\b/);
    expect(source).not.toMatch(/\bClaudeActivityType\b/);
  });

  test("conserve FollowupSection (toujours utilisé)", () => {
    // Régression inverse : on ne veut PAS perdre Followup qui est legit
    expect(source).toMatch(/export\s+function\s+FollowupSection/);
  });
});
