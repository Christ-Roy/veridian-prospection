/**
 * Tests de GET /api/admin/members/[userId]/history.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireAdminMock, prismaMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  prismaMock: {
    workspaceMember: { findFirst: vi.fn() },
    outreach: { findMany: vi.fn() },
    callLog: { findMany: vi.fn() },
    claudeActivity: { findMany: vi.fn() },
    followups: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth/user-context", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    workspaceMember = prismaMock.workspaceMember;
    outreach = prismaMock.outreach;
    callLog = prismaMock.callLog;
    claudeActivity = prismaMock.claudeActivity;
    followups = prismaMock.followups;
  }
  return { PrismaClient };
});

import { GET } from "@/app/api/admin/members/[userId]/history/route";
import { makeRequest, makeUserContext, makeForbidden } from "../../../_helpers";

describe("GET /api/admin/members/[userId]/history", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 403 for non-admin", async () => {
    requireAdminMock.mockResolvedValue(await makeForbidden());
    const res = await GET(makeRequest("/api/admin/members/u-1/history"), {
      params: Promise.resolve({ userId: "u-1" }),
    });
    expect(res.status).toBe(403);
  });

  test("returns empty events when user has no activity (tenant-scoped)", async () => {
    requireAdminMock.mockResolvedValue({
      ctx: makeUserContext({ isAdmin: true, tenantId: "t-1" }),
    });
    prismaMock.outreach.findMany.mockResolvedValue([]);
    prismaMock.callLog.findMany.mockResolvedValue([]);
    prismaMock.claudeActivity.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest("/api/admin/members/u-1/history"), {
      params: Promise.resolve({ userId: "u-1" }),
    });
    expect(res.status).toBe(200);
  });
});
