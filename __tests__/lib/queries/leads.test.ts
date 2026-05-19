/**
 * Tests focalisés sur le contrat public de getHistoryLeads, suite au refactor
 * visibility cross-membre (2026-05-19).
 *
 * Périmètre :
 *   - Validation UUID stricte de userId (anti SQL injection)
 *   - Signature : tenantId optionnel + userId optionnel
 *
 * Pas de test sur les autres exports (getLeads, getLeadDetail, getLeadsBySiren)
 * — ils sont en dette tests-pending.txt indépendamment de cette PR.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

import { getHistoryLeads } from "@/lib/queries/leads";
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
