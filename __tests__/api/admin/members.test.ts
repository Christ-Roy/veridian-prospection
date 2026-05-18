/**
 * Tests des routes /api/admin/members (GET list, PATCH visibility_scope).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const { requireAdminMock, prismaMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  prismaMock: {
    workspace: { findMany: vi.fn() },
    workspaceMember: { update: vi.fn(), findFirst: vi.fn() },
    outreach: { groupBy: vi.fn() },
    callLog: { groupBy: vi.fn() },
    claudeActivity: { groupBy: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    tenant: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireAdmin: requireAdminMock,
  invalidateUserContext: vi.fn(),
}));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    workspace = prismaMock.workspace;
    workspaceMember = prismaMock.workspaceMember;
    outreach = prismaMock.outreach;
    callLog = prismaMock.callLog;
    claudeActivity = prismaMock.claudeActivity;
    user = prismaMock.user;
    tenant = prismaMock.tenant;
  }
  return { PrismaClient };
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { admin: { listUsers: vi.fn().mockResolvedValue({ data: { users: [] } }) } } })),
}));

import { GET, PATCH } from "@/app/api/admin/members/route";
import { makeRequest, makeUserContext, makeForbidden } from "../_helpers";

describe("/api/admin/members", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await GET();
      expect(res.status).toBe(403);
    });

    test("returns empty list when no workspaces", async () => {
      requireAdminMock.mockResolvedValue({ ctx: makeUserContext({ isAdmin: true }) });
      prismaMock.workspace.findMany.mockResolvedValue([]);
      prismaMock.outreach.groupBy.mockResolvedValue([]);
      prismaMock.callLog.groupBy.mockResolvedValue([]);
      prismaMock.claudeActivity.groupBy.mockResolvedValue([]);
      const res = await GET();
      expect(res.status).toBe(200);
    });
  });

  describe("PATCH", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await PATCH(
        makeRequest("/api/admin/members", {
          method: "PATCH",
          body: { userId: "u-1", workspaceId: "w-1", visibilityScope: "all" },
        }),
      );
      expect(res.status).toBe(403);
    });
  });
});
