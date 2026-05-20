/**
 * Tests focalisés sur le contrat public de getHistoryLeads, suite au refactor
 * visibility cross-membre (2026-05-19).
 *
 * Périmètre :
 *   - Validation UUID stricte de userId (anti SQL injection)
 *   - Signature : tenantId optionnel + userId optionnel
 *   - Surface des exports (anti-régression Twenty removal 2026-05-20)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

import { getHistoryLeads } from "@/lib/queries/leads";
import * as leadsModule from "@/lib/queries/leads";
import { prisma } from "@/lib/prisma";

describe("getHistoryLeads — visibility refactor 2026-05-19", () => {
  beforeEach(() => vi.clearAllMocks());

  test("appelle Prisma sans clause user si userId omis", async () => {
    await getHistoryLeads(100, "00000000-0000-4000-8000-000000000001");
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).not.toMatch(/o\.user_id\s*=/);
  });

  test("ajoute clause o.user_id = '<uid>' quand userId fourni", async () => {
    const uid = "00000000-0000-4000-8000-000000000002";
    await getHistoryLeads(100, "00000000-0000-4000-8000-000000000001", uid);
    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain(`o.user_id = '${uid}'`);
  });

  test("rejette userId non-UUID (anti SQL injection)", async () => {
    await expect(
      getHistoryLeads(100, "00000000-0000-4000-8000-000000000001", "'; DROP TABLE outreach;--"),
    ).rejects.toThrow(/invalid userId/);
  });

  test("rejette userId avec espace (anti SQL injection)", async () => {
    await expect(
      getHistoryLeads(100, "00000000-0000-4000-8000-000000000001", "abc 123"),
    ).rejects.toThrow(/invalid userId/);
  });
});

// Anti-régression : Twenty CRM supprimé (2026-05-20). Les fonctions
// getLeadsBySiren / getLeadsByDomains n'étaient consommées que par les
// routes Twenty supprimées. Si quelqu'un les ré-introduit sans recâbler
// un vrai caller, ce test casse et oblige à justifier l'ajout.
describe("surface des exports — anti-régression Twenty removal", () => {
  test("getLeadsBySiren n'est plus exporté", () => {
    expect((leadsModule as Record<string, unknown>).getLeadsBySiren).toBeUndefined();
  });
  test("getLeadsByDomains (alias legacy) n'est plus exporté", () => {
    expect((leadsModule as Record<string, unknown>).getLeadsByDomains).toBeUndefined();
  });
  test("exports actifs présents et callables", () => {
    expect(typeof leadsModule.getLeads).toBe("function");
    expect(typeof leadsModule.getLeadDetail).toBe("function");
    expect(typeof leadsModule.getHistoryLeads).toBe("function");
  });
});
