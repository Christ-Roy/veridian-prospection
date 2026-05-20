/**
 * Tests sur src/lib/queries/activity.ts.
 *
 * Couvre :
 *   - Surface des exports actifs (ClaudeActivity + Followup)
 *   - Anti-régression cleanup Claude+email 2026-05-20 :
 *     addOutreachEmail, getOutreachEmails, type OutreachEmail supprimés
 *
 * Pas de test fonctionnel profond ici — les fonctions Claude/Followup
 * sont consommées par phone/* et /api/followups dont les tests d'intégration
 * couvrent le comportement réel contre Prisma. Ce fichier garantit juste
 * que la surface ne dérive pas.
 */
import { describe, expect, test } from "vitest";

import * as activityModule from "@/lib/queries/activity";

describe("@/lib/queries/activity — surface API", () => {
  test("exporte les fonctions Claude attendues", () => {
    expect(typeof activityModule.getClaudeActivities).toBe("function");
    expect(typeof activityModule.addClaudeActivity).toBe("function");
    expect(typeof activityModule.updateClaudeActivity).toBe("function");
    expect(typeof activityModule.getClaudeStats).toBe("function");
    expect(typeof activityModule.getClaudeAnalyzedCount).toBe("function");
  });

  test("exporte les fonctions Followup attendues", () => {
    expect(typeof activityModule.getFollowups).toBe("function");
    expect(typeof activityModule.addFollowup).toBe("function");
    expect(typeof activityModule.updateFollowup).toBe("function");
  });
});

// Anti-régression cleanup Claude+email himalaya legacy (2026-05-20) :
// l'envoi email via himalaya CLI a été supprimé et la table outreach_emails
// n'a plus de writer. Le module ne doit plus exposer ces helpers.
describe("activity — anti-régression Claude+email cleanup 2026-05-20", () => {
  test("addOutreachEmail n'est plus exporté", () => {
    expect((activityModule as Record<string, unknown>).addOutreachEmail).toBeUndefined();
  });
  test("getOutreachEmails n'est plus exporté", () => {
    expect((activityModule as Record<string, unknown>).getOutreachEmails).toBeUndefined();
  });

  test("source ne contient plus prisma.outreachEmail.* ni l'interface OutreachEmail", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(process.cwd(), "src/lib/queries/activity.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/prisma\.outreachEmail/);
    expect(source).not.toMatch(/interface OutreachEmail/);
    expect(source).not.toMatch(/addOutreachEmail/);
    expect(source).not.toMatch(/getOutreachEmails/);
  });
});
