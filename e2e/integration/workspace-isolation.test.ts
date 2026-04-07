/**
 * Workspace isolation tests (SIREN-centric, 2026-04-05).
 *
 * Validates row partitioning by workspace_id inside a tenant, across the 4
 * business tables (outreach, call_log, followups, claude_activity).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OTHER_TENANT = "dddddddd-dddd-dddd-dddd-dddddddddddd";

let WS_PARIS: string;
let WS_LYON: string;
let WS_OTHER_TENANT: string;

const USER_ADMIN = "11111111-1111-1111-1111-111111111111";
const USER_MEMBER_PARIS = "22222222-2222-2222-2222-222222222222";
const USER_MEMBER_LYON = "33333333-3333-3333-3333-333333333333";

// Dynamic fictitious SIRENs — prefix 999 never exists in real SIRENE data.
// Unique per run so parallel test files never conflict.
const RUN_ID = Date.now().toString().slice(-6);
const SIREN_1 = `999${RUN_ID}1`.slice(0, 9);
const SIREN_2 = `999${RUN_ID}2`.slice(0, 9);

let skip = false;

beforeAll(async () => {
  // Create fictitious entreprises for FK constraints — unique per run, no conflict.
  try {
    await prisma.entreprise.createMany({
      data: [
        { siren: SIREN_1, denomination: `WS-TEST-A-${RUN_ID}` },
        { siren: SIREN_2, denomination: `WS-TEST-B-${RUN_ID}` },
      ],
      skipDuplicates: true,
    });
  } catch (err) {
    skip = true;
    console.warn("[workspace-isolation] Failed to seed test entreprises:", err);
    return;
  }

  const paris = await prisma.workspace.create({
    data: { tenantId: TENANT, name: "Test-Paris", slug: `test-paris-${Date.now()}` },
  });
  WS_PARIS = paris.id;

  const lyon = await prisma.workspace.create({
    data: { tenantId: TENANT, name: "Test-Lyon", slug: `test-lyon-${Date.now()}` },
  });
  WS_LYON = lyon.id;

  const other = await prisma.workspace.create({
    data: {
      tenantId: OTHER_TENANT,
      name: "Test-OtherTenant",
      slug: `test-other-${Date.now()}`,
    },
  });
  WS_OTHER_TENANT = other.id;

  await prisma.workspaceMember.create({
    data: { workspaceId: WS_PARIS, userId: USER_ADMIN, role: "admin" },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: WS_LYON, userId: USER_ADMIN, role: "admin" },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: WS_PARIS, userId: USER_MEMBER_PARIS, role: "member" },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: WS_LYON, userId: USER_MEMBER_LYON, role: "member" },
  });
});

afterAll(async () => {
  if (skip) {
    await prisma.$disconnect();
    return;
  }
  await prisma.outreach.deleteMany({
    where: { siren: { in: [SIREN_1, SIREN_2] }, tenantId: { in: [TENANT, OTHER_TENANT] } },
  });
  await prisma.callLog.deleteMany({
    where: { siren: { in: [SIREN_1, SIREN_2] }, tenantId: { in: [TENANT, OTHER_TENANT] } },
  });
  await prisma.followup.deleteMany({
    where: { siren: { in: [SIREN_1, SIREN_2] }, tenantId: { in: [TENANT, OTHER_TENANT] } },
  });
  await prisma.claudeActivity.deleteMany({
    where: { siren: { in: [SIREN_1, SIREN_2] }, tenantId: { in: [TENANT, OTHER_TENANT] } },
  });
  await prisma.workspace.deleteMany({
    where: { id: { in: [WS_PARIS, WS_LYON, WS_OTHER_TENANT] } },
  });
  await prisma.entreprise.deleteMany({
    where: { siren: { in: [SIREN_1, SIREN_2] } },
  });
  await prisma.$disconnect();
});

describe.skipIf(skip)("Workspace isolation (within tenant)", () => {
  describe("outreach", () => {
    it("outreach in workspace Paris is not visible when filtering on Lyon", async () => {
      await prisma.outreach.create({
        data: {
          siren: SIREN_1,
          tenantId: TENANT,
          workspaceId: WS_PARIS,
          status: "contacte",
          notes: "Paris lead",
        },
      });

      const parisRows = await prisma.outreach.findMany({
        where: { tenantId: TENANT, workspaceId: WS_PARIS, siren: SIREN_1 },
      });
      const lyonRows = await prisma.outreach.findMany({
        where: { tenantId: TENANT, workspaceId: WS_LYON, siren: SIREN_1 },
      });

      expect(parisRows).toHaveLength(1);
      expect(parisRows[0].notes).toBe("Paris lead");
      expect(lyonRows).toHaveLength(0);
    });

    it("admin view (no workspace filter) returns rows from all workspaces in tenant", async () => {
      await prisma.outreach.upsert({
        where: { siren_tenantId: { siren: SIREN_2, tenantId: TENANT } },
        create: {
          siren: SIREN_2,
          tenantId: TENANT,
          workspaceId: WS_LYON,
          status: "contacte",
          notes: "Lyon lead",
        },
        update: { workspaceId: WS_LYON, notes: "Lyon lead" },
      });

      const adminView = await prisma.outreach.findMany({
        where: {
          tenantId: TENANT,
          siren: { in: [SIREN_1, SIREN_2] },
        },
      });
      expect(adminView.length).toBeGreaterThanOrEqual(2);
      const wsSeen = new Set(adminView.map((r) => r.workspaceId));
      expect(wsSeen.has(WS_PARIS)).toBe(true);
      expect(wsSeen.has(WS_LYON)).toBe(true);
    });

    it("member_paris filter only sees Paris rows", async () => {
      const memberView = await prisma.outreach.findMany({
        where: {
          tenantId: TENANT,
          workspaceId: { in: [WS_PARIS] },
          siren: { in: [SIREN_1, SIREN_2] },
        },
      });
      expect(memberView.length).toBeGreaterThanOrEqual(1);
      expect(memberView.every((r) => r.workspaceId === WS_PARIS)).toBe(true);
      expect(memberView.some((r) => r.siren === SIREN_2)).toBe(false);
    });

    it("member with empty workspace list sees nothing", async () => {
      const emptyView = await prisma.outreach.findMany({
        where: {
          tenantId: TENANT,
          workspaceId: { in: [] },
          siren: { in: [SIREN_1, SIREN_2] },
        },
      });
      expect(emptyView).toHaveLength(0);
    });
  });

  describe("call_log", () => {
    it("call_log rows respect workspace scoping", async () => {
      await prisma.callLog.create({
        data: {
          tenantId: TENANT,
          workspaceId: WS_PARIS,
          direction: "outgoing",
          provider: "telnyx",
          siren: SIREN_1,
          status: "completed",
          startedAt: new Date().toISOString(),
          durationSeconds: 120,
        },
      });
      await prisma.callLog.create({
        data: {
          tenantId: TENANT,
          workspaceId: WS_LYON,
          direction: "outgoing",
          provider: "telnyx",
          siren: SIREN_2,
          status: "completed",
          startedAt: new Date().toISOString(),
          durationSeconds: 60,
        },
      });

      const parisCalls = await prisma.callLog.findMany({
        where: { tenantId: TENANT, workspaceId: WS_PARIS, siren: SIREN_1 },
      });
      const lyonCalls = await prisma.callLog.findMany({
        where: { tenantId: TENANT, workspaceId: WS_LYON, siren: SIREN_2 },
      });
      const crossCheck = await prisma.callLog.findMany({
        where: { tenantId: TENANT, workspaceId: WS_PARIS, siren: SIREN_2 },
      });

      expect(parisCalls).toHaveLength(1);
      expect(lyonCalls).toHaveLength(1);
      expect(crossCheck).toHaveLength(0);
    });
  });

  describe("followups", () => {
    it("followups are partitioned by workspace", async () => {
      await prisma.followup.create({
        data: {
          tenantId: TENANT,
          workspaceId: WS_PARIS,
          siren: SIREN_1,
          scheduledAt: new Date().toISOString(),
          status: "pending",
          note: "Paris followup",
        },
      });

      const parisFu = await prisma.followup.findMany({
        where: { tenantId: TENANT, workspaceId: WS_PARIS, siren: SIREN_1 },
      });
      const lyonFu = await prisma.followup.findMany({
        where: { tenantId: TENANT, workspaceId: WS_LYON, siren: SIREN_1 },
      });

      expect(parisFu).toHaveLength(1);
      expect(parisFu[0].note).toBe("Paris followup");
      expect(lyonFu).toHaveLength(0);
    });
  });

  describe("claude_activity", () => {
    it("claude activities are partitioned by workspace", async () => {
      await prisma.claudeActivity.create({
        data: {
          tenantId: TENANT,
          workspaceId: WS_PARIS,
          siren: SIREN_1,
          activityType: "note",
          content: "Paris analysis",
        },
      });

      const parisActs = await prisma.claudeActivity.findMany({
        where: { tenantId: TENANT, workspaceId: WS_PARIS, siren: SIREN_1 },
      });
      const lyonActs = await prisma.claudeActivity.findMany({
        where: { tenantId: TENANT, workspaceId: WS_LYON, siren: SIREN_1 },
      });

      expect(parisActs).toHaveLength(1);
      expect(parisActs[0].content).toBe("Paris analysis");
      expect(lyonActs).toHaveLength(0);
    });
  });

  describe("cross-tenant isolation (defense in depth)", () => {
    it("workspace from other tenant is not visible when filtering on current tenant", async () => {
      await prisma.workspaceMember.create({
        data: { workspaceId: WS_OTHER_TENANT, userId: USER_ADMIN, role: "admin" },
      });
      await prisma.outreach.create({
        data: {
          siren: SIREN_1,
          tenantId: OTHER_TENANT,
          workspaceId: WS_OTHER_TENANT,
          status: "contacte",
          notes: "Other tenant data",
        },
      });

      const currentTenantView = await prisma.outreach.findMany({
        where: { tenantId: TENANT, siren: SIREN_1 },
      });
      expect(currentTenantView.some((r) => r.notes === "Other tenant data")).toBe(false);

      const workspaceView = await prisma.outreach.findMany({
        where: { workspaceId: WS_OTHER_TENANT, siren: SIREN_1 },
      });
      expect(workspaceView.length).toBeGreaterThan(0);
    });
  });

  describe("workspace CRUD integrity", () => {
    it("cannot create two workspaces with the same (tenantId, slug)", async () => {
      const slug = `unique-test-${Date.now()}`;
      await prisma.workspace.create({
        data: { tenantId: TENANT, name: "Dup test 1", slug },
      });
      await expect(
        prisma.workspace.create({
          data: { tenantId: TENANT, name: "Dup test 2", slug },
        })
      ).rejects.toThrow();

      await prisma.workspace.deleteMany({ where: { tenantId: TENANT, slug } });
    });

    it("deleting a workspace cascades delete of workspace_members", async () => {
      const slug = `cascade-test-${Date.now()}`;
      const ws = await prisma.workspace.create({
        data: { tenantId: TENANT, name: "Cascade test", slug },
      });
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: USER_ADMIN, role: "admin" },
      });

      await prisma.workspace.delete({ where: { id: ws.id } });

      const orphans = await prisma.workspaceMember.findMany({
        where: { workspaceId: ws.id },
      });
      expect(orphans).toHaveLength(0);
    });
  });
});
