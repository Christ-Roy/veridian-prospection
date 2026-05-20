/**
 * Tests sur le barrel src/lib/queries/index.ts.
 *
 * Le rôle du barrel est de centraliser les re-exports pour permettre
 * `import { getLeads, getStats } from "@/lib/queries"`. Une régression
 * silencieuse (export supprimé ou renommé) casserait des routes API en
 * production sans qu'aucun typecheck ne s'en plaigne si le caller utilise
 * `import * as q` ou un dynamic access.
 *
 * Ce test verrouille la **surface API publique** du barrel.
 */
import { describe, expect, test } from "vitest";

import * as queries from "@/lib/queries";

describe("@/lib/queries — surface du barrel", () => {
  // Liste figée : pour ajouter un export, AJOUTE le ici en même temps que
  // l'export dans index.ts. Pour en retirer un, REPRESENTE-toi le caller
  // qui va casser. Tu retires consciemment, pas par accident.
  const EXPECTED_FUNCTIONS = [
    // leads
    "getLeads",
    "getLeadDetail",
    "getHistoryLeads",
    // stats
    "getStats",
    // pipeline
    "getPipelineLeads",
    "updateOutreach",
    "patchOutreach",
    "recordVisit",
    "getPipelineColumnOrder",
    "savePipelineColumnOrder",
    "reorderPipelineCards",
    "batchReorderPipelineCards",
    // segments
    "getSmartSegmentLeads",
    "getManualSegmentLeads",
    "getPjSegmentLeads",
    "getSegmentLeads",
    "getSegmentCount",
    "getAllSegmentCounts",
    "addToSegment",
    "removeFromSegment",
    // activity
    "getClaudeActivities",
    "addClaudeActivity",
    "getClaudeStats",
    "getClaudeAnalyzedCount",
    "updateClaudeActivity",
    "getFollowups",
    "addFollowup",
    "updateFollowup",
    // prospects
    "getProspects",
    "getDomainCounts",
    "getPresetCounts",
    "getSetting",
    "setSetting",
    "getAllSettings",
  ] as const;

  test.each(EXPECTED_FUNCTIONS)("exporte la fonction %s", (name) => {
    expect(typeof (queries as Record<string, unknown>)[name]).toBe("function");
  });

  // Anti-régression Twenty removal (2026-05-20) : ces deux exports étaient
  // consommés uniquement par /api/twenty/* qui n'existe plus.
  test("getLeadsBySiren n'est plus exporté depuis le barrel", () => {
    expect((queries as Record<string, unknown>).getLeadsBySiren).toBeUndefined();
  });
  test("getLeadsByDomains n'est plus exporté depuis le barrel", () => {
    expect((queries as Record<string, unknown>).getLeadsByDomains).toBeUndefined();
  });

  // Anti-régression Claude/email cleanup (2026-05-20) : envoi email via
  // himalaya CLI supprimé, table outreach_emails n'est plus écrite.
  test("addOutreachEmail n'est plus exporté", () => {
    expect((queries as Record<string, unknown>).addOutreachEmail).toBeUndefined();
  });
  test("getOutreachEmails n'est plus exporté", () => {
    expect((queries as Record<string, unknown>).getOutreachEmails).toBeUndefined();
  });
});
