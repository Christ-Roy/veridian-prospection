/**
 * Tests des routes /api/admin/members (GET list, PATCH visibility_scope).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

const { requireAdminMock, prismaMock, emitHubWebhookAsyncMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  emitHubWebhookAsyncMock: vi.fn(),
  prismaMock: {
    workspace: { findFirst: vi.fn(), findMany: vi.fn() },
    workspaceMember: {
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
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
vi.mock("@/lib/hub/webhooks", () => ({
  emitHubWebhookAsync: emitHubWebhookAsyncMock,
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

    test("émet webhook tenant.member_role_changed quand visibility_scope change (§5.18.4)", async () => {
      requireAdminMock.mockResolvedValue({
        ctx: makeUserContext({
          isAdmin: true,
          userId: "admin-1",
          tenantId: "tenant-1",
        }),
      });
      prismaMock.workspace.findFirst.mockResolvedValue({ id: "ws-1" });
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        role: "member",
        visibilityScope: "own",
      });
      prismaMock.workspaceMember.update.mockResolvedValue({});
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ email: "bob@example.com" })
        .mockResolvedValueOnce({ email: "admin@example.com" });

      const res = await PATCH(
        makeRequest("/api/admin/members", {
          method: "PATCH",
          body: { userId: "u-bob", workspaceId: "ws-1", visibilityScope: "all" },
        }),
      );
      expect(res.status).toBe(200);
      expect(emitHubWebhookAsyncMock).toHaveBeenCalledOnce();
      const payload = emitHubWebhookAsyncMock.mock.calls[0][2];
      expect(payload.visibility_scope).toBe("all");
      expect(payload.user_email).toBe("bob@example.com");
      expect(payload.changed_by).toBe("admin@example.com");
    });

    test("PAS d'émission si visibility_scope identique (idempotent silencieux)", async () => {
      requireAdminMock.mockResolvedValue({
        ctx: makeUserContext({
          isAdmin: true,
          userId: "admin-1",
          tenantId: "tenant-1",
        }),
      });
      prismaMock.workspace.findFirst.mockResolvedValue({ id: "ws-1" });
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        role: "member",
        visibilityScope: "all",
      });
      prismaMock.workspaceMember.update.mockResolvedValue({});

      const res = await PATCH(
        makeRequest("/api/admin/members", {
          method: "PATCH",
          body: { userId: "u-bob", workspaceId: "ws-1", visibilityScope: "all" },
        }),
      );
      expect(res.status).toBe(200);
      expect(emitHubWebhookAsyncMock).not.toHaveBeenCalled();
    });
  });
});
