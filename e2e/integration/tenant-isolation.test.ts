/**
 * Multi-tenant data isolation tests (SIREN-centric, 2026-04-05 refactor).
 *
 * Validates that rows in outreach / claude_activity / followups / lead_segments
 * are correctly partitioned by tenant_id. Uses real SIREN values from the
 * `entreprises` table (no more `results` legacy).
 *
 * Run: npx vitest run e2e/integration/tenant-isolation.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// Dynamic fictitious SIRENs — prefix 998 (different from workspace-isolation's 999).
// Unique per run so parallel test files never conflict.
const RUN_ID = Date.now().toString().slice(-6);
const SIREN_A = `998${RUN_ID}1`.slice(0, 9);
const SIREN_B = `998${RUN_ID}2`.slice(0, 9);
const SIREN_SHARED = `998${RUN_ID}3`.slice(0, 9);

let skip = false;

beforeAll(async () => {
  // Create fictitious entreprises for FK constraints — unique per run, no conflict.
  try {
    await prisma.entreprise.createMany({
      data: [
        { siren: SIREN_A, denomination: `TI-TEST-A-${RUN_ID}` },
        { siren: SIREN_B, denomination: `TI-TEST-B-${RUN_ID}` },
        { siren: SIREN_SHARED, denomination: `TI-TEST-SHARED-${RUN_ID}` },
      ],
      skipDuplicates: true,
    });
  } catch (err) {
    skip = true;
    console.warn("[tenant-isolation] Failed to seed test entreprises:", err);
  }
});

afterAll(async () => {
  try {
    // Cleanup: remove any rows we created for TENANT_A and TENANT_B
    // Use raw SQL with CASCADE-aware order to avoid FK violations
    const testTenants = [TENANT_A, TENANT_B];
    const testSirens = [SIREN_A, SIREN_B, SIREN_SHARED];

    // Delete in FK-safe order: children first, parents last
    for (const table of ['outreach_email', 'call_log', 'claude_activity', 'followups', 'lead_segments', 'outreach']) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${table} WHERE tenant_id IN ($1::uuid, $2::uuid)`,
        ...testTenants,
      ).catch(() => {});
      // Also by siren (some FKs are on siren, not tenant_id)
      if (testSirens.length > 0) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM ${table} WHERE siren IN (${testSirens.map((_, i) => `$${i + 1}`).join(',')})`,
          ...testSirens,
        ).catch(() => {});
      }
    }

    await prisma.entreprise.deleteMany({
      where: { siren: { in: testSirens } },
    }).catch(() => {});
  } catch (err) {
    console.warn("[tenant-isolation] Cleanup error (non-fatal):", err);
  }
  await prisma.$disconnect();
});

describe.skipIf(skip)("Multi-tenant isolation (SIREN-centric)", () => {
  describe("outreach", () => {
    it("tenant A writes outreach, tenant B cannot see it", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO outreach (siren, tenant_id, status, notes) VALUES ($1, $2::uuid, 'contacte', 'tenant A notes') ON CONFLICT (siren, tenant_id) DO UPDATE SET notes = 'tenant A notes'`,
        SIREN_A,
        TENANT_A,
      );

      const rowsA = await prisma.$queryRawUnsafe<{ siren: string }[]>(
        `SELECT siren FROM outreach WHERE tenant_id = $1::uuid AND siren = $2`,
        TENANT_A,
        SIREN_A,
      );
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0].siren).toBe(SIREN_A);

      const rowsB = await prisma.$queryRawUnsafe<{ siren: string }[]>(
        `SELECT siren FROM outreach WHERE tenant_id = $1::uuid AND siren = $2`,
        TENANT_B,
        SIREN_A,
      );
      expect(rowsB).toHaveLength(0);
    });

    it("both tenants can outreach the same lead independently", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO outreach (siren, tenant_id, status) VALUES ($1, $2::uuid, 'contacte') ON CONFLICT (siren, tenant_id) DO NOTHING`,
        SIREN_SHARED,
        TENANT_A,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO outreach (siren, tenant_id, status) VALUES ($1, $2::uuid, 'interesse') ON CONFLICT (siren, tenant_id) DO NOTHING`,
        SIREN_SHARED,
        TENANT_B,
      );

      const rowsA = await prisma.$queryRawUnsafe<{ status: string }[]>(
        `SELECT status FROM outreach WHERE siren = $1 AND tenant_id = $2::uuid`,
        SIREN_SHARED,
        TENANT_A,
      );
      const rowsB = await prisma.$queryRawUnsafe<{ status: string }[]>(
        `SELECT status FROM outreach WHERE siren = $1 AND tenant_id = $2::uuid`,
        SIREN_SHARED,
        TENANT_B,
      );

      expect(rowsA).toHaveLength(1);
      expect(rowsA[0].status).toBe("contacte");
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0].status).toBe("interesse");
    });
  });

  describe("claude_activity", () => {
    it("tenant A activities are isolated from tenant B", async () => {
      await prisma.claudeActivity.create({
        data: {
          siren: SIREN_A,
          tenantId: TENANT_A,
          activityType: "analysis",
          content: "Test analysis for tenant A",
        },
      });

      await prisma.claudeActivity.create({
        data: {
          siren: SIREN_B,
          tenantId: TENANT_B,
          activityType: "analysis",
          content: "Test analysis for tenant B",
        },
      });

      const activitiesA = await prisma.claudeActivity.findMany({
        where: { tenantId: TENANT_A },
      });
      const activitiesB = await prisma.claudeActivity.findMany({
        where: { tenantId: TENANT_B },
      });

      expect(activitiesA.every((a) => a.tenantId === TENANT_A)).toBe(true);
      expect(activitiesB.every((a) => a.tenantId === TENANT_B)).toBe(true);

      expect(activitiesA.some((a) => a.siren === SIREN_B)).toBe(false);
      expect(activitiesB.some((a) => a.siren === SIREN_A)).toBe(false);
    });
  });

  describe("followups", () => {
    it("tenant A followups are not visible to tenant B", async () => {
      await prisma.followup.create({
        data: {
          siren: SIREN_A,
          tenantId: TENANT_A,
          scheduledAt: new Date().toISOString(),
          status: "pending",
          note: "Call back tenant A",
        },
      });

      const followupsA = await prisma.followup.findMany({
        where: { tenantId: TENANT_A },
      });
      const followupsB = await prisma.followup.findMany({
        where: { tenantId: TENANT_B },
      });

      expect(followupsA.length).toBeGreaterThan(0);
      expect(followupsB.some((f) => f.siren === SIREN_A)).toBe(false);
    });
  });

  describe("lead_segments", () => {
    it("manual segments are isolated by tenant", async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO lead_segments (siren, segment, tenant_id, added_at) VALUES ($1, 'audit', $2::uuid, NOW()) ON CONFLICT DO NOTHING`,
        SIREN_A,
        TENANT_A,
      );

      const segA = await prisma.$queryRawUnsafe<{ siren: string }[]>(
        `SELECT siren FROM lead_segments WHERE tenant_id = $1::uuid`,
        TENANT_A,
      );
      const segB = await prisma.$queryRawUnsafe<{ siren: string }[]>(
        `SELECT siren FROM lead_segments WHERE tenant_id = $1::uuid`,
        TENANT_B,
      );

      expect(segA.some((s) => s.siren === SIREN_A)).toBe(true);
      expect(segB.some((s) => s.siren === SIREN_A)).toBe(false);
    });
  });

  describe("entreprises (shared table)", () => {
    it("all tenants see the same entreprises row", async () => {
      const rowA = await prisma.entreprise.findUnique({ where: { siren: SIREN_A } });
      const rowB = await prisma.entreprise.findUnique({ where: { siren: SIREN_A } });
      expect(rowA).not.toBeNull();
      expect(rowB).not.toBeNull();
      expect(rowA?.siren).toBe(rowB?.siren);
    });
  });
});
