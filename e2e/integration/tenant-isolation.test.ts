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

// Three real SIREN from the entreprises table (all known diamond prospects)
// We assume these exist in staging. If the test runs against a fresh DB,
// it will be skipped gracefully.
const SIREN_A = "439076563"; // POLLEN SCOP
const SIREN_B = "410829477"; // OXALIS
const SIREN_SHARED = "495204125"; // A DEUX ET PLUS

let skip = false;
let createdSirens: string[] = [];

beforeAll(async () => {
  // Seed test SIREN into entreprises so FK constraints on outreach/followups/
  // claude_activity/lead_segments can resolve. In CI the Postgres is ephemeral
  // and entreprises is empty. Locally (against a real DB) the rows already
  // exist, so we only create the missing ones and only cleanup what we created.
  const existing = await prisma.entreprise.findMany({
    where: { siren: { in: [SIREN_A, SIREN_B, SIREN_SHARED] } },
    select: { siren: true },
  });
  const existingSet = new Set(existing.map((e) => e.siren));
  const toCreate: { siren: string; denomination: string }[] = [];
  if (!existingSet.has(SIREN_A)) toCreate.push({ siren: SIREN_A, denomination: "POLLEN SCOP (test)" });
  if (!existingSet.has(SIREN_B)) toCreate.push({ siren: SIREN_B, denomination: "OXALIS (test)" });
  if (!existingSet.has(SIREN_SHARED))
    toCreate.push({ siren: SIREN_SHARED, denomination: "A DEUX ET PLUS (test)" });
  if (toCreate.length > 0) {
    try {
      await prisma.entreprise.createMany({ data: toCreate, skipDuplicates: true });
      createdSirens = toCreate.map((e) => e.siren);
    } catch (err) {
      console.warn("[tenant-isolation] Failed to seed test SIREN:", err);
    }
  }

  const rows = await prisma.entreprise.findMany({
    where: { siren: { in: [SIREN_A, SIREN_B, SIREN_SHARED] } },
    select: { siren: true },
  });
  if (rows.length < 3) {
    skip = true;
    console.warn("[tenant-isolation] Not all test SIREN exist in entreprises, skipping");
  }
});

afterAll(async () => {
  // Cleanup: remove any rows we created for TENANT_A and TENANT_B
  await prisma.$executeRawUnsafe(
    `DELETE FROM outreach WHERE tenant_id IN ($1::uuid, $2::uuid)`,
    TENANT_A,
    TENANT_B,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM claude_activity WHERE tenant_id IN ($1::uuid, $2::uuid)`,
    TENANT_A,
    TENANT_B,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM followups WHERE tenant_id IN ($1::uuid, $2::uuid)`,
    TENANT_A,
    TENANT_B,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM lead_segments WHERE tenant_id IN ($1::uuid, $2::uuid)`,
    TENANT_A,
    TENANT_B,
  );
  if (createdSirens.length > 0) {
    // Delete ALL outreach/call_log/claude_activity referencing these SIRENs
    // (not just by tenant_id — FK is on siren, any tenant's rows block deletion)
    for (const table of ['outreach_email', 'outreach', 'call_log', 'claude_activity', 'followups', 'lead_segments']) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${table} WHERE siren IN (${createdSirens.map((_, i) => `$${i + 1}`).join(',')})`,
        ...createdSirens,
      );
    }
    await prisma.entreprise.deleteMany({
      where: { siren: { in: createdSirens } },
    });
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
