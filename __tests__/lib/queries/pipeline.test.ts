/**
 * Tests focalisés sur la validation UUID userFilter de getPipelineLeads,
 * ajoutée suite au refactor visibility cross-membre (2026-05-19).
 *
 * Périmètre : uniquement les changements liés à la PR. Le reste de
 * getPipelineLeads (group by stage, calcul email_count, etc.) reste en
 * tests-pending.txt.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

import { getPipelineLeads } from "@/lib/queries/pipeline";
import { prisma } from "@/lib/prisma";

const T = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";

describe("getPipelineLeads — visibility refactor 2026-05-19", () => {
  beforeEach(() => vi.clearAllMocks());

  test("accepte userFilter UUID valide", async () => {
    await expect(getPipelineLeads(T, null, U)).resolves.toBeDefined();
    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain(`o.user_id = '${U}'`);
  });

  test("accepte userFilter null (admin / team-view)", async () => {
    await expect(getPipelineLeads(T, null, null)).resolves.toBeDefined();
    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).not.toMatch(/AND o\.user_id\s*=/);
  });

  test("rejette userFilter non-UUID (anti SQL injection)", async () => {
    await expect(getPipelineLeads(T, null, "'; DROP TABLE outreach;--"))
      .rejects.toThrow(/invalid userFilter/);
  });

  test("rejette userFilter avec wildcard SQL", async () => {
    await expect(getPipelineLeads(T, null, "%' OR 1=1 --"))
      .rejects.toThrow(/invalid userFilter/);
  });
});
