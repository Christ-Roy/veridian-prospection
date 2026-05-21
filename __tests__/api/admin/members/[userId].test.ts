/**
 * Tests des routes /api/admin/members/[userId] (PATCH role, DELETE remove).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireAdminMock, prismaMock, emitHubWebhookAsyncMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  emitHubWebhookAsyncMock: vi.fn(),
  prismaMock: {
    workspaceMember: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    workspace: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireAdmin: requireAdminMock,
  invalidateUserContext: vi.fn(),
}));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    workspaceMember = prismaMock.workspaceMember;
    workspace = prismaMock.workspace;
    user = prismaMock.user;
  }
  return { PrismaClient };
});
vi.mock("@/lib/hub/webhooks", () => ({
  emitHubWebhookAsync: emitHubWebhookAsyncMock,
}));

import { PATCH, DELETE } from "@/app/api/admin/members/[userId]/route";
import { makeRequest, makeForbidden } from "../../_helpers";

describe("/api/admin/members/[userId]", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("PATCH", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await PATCH(
        makeRequest("/api/admin/members/u-1", {
          method: "PATCH",
          body: { role: "admin" },
        }),
        { params: Promise.resolve({ userId: "u-1" }) },
      );
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await DELETE(
        makeRequest("/api/admin/members/u-1", { method: "DELETE" }),
        { params: Promise.resolve({ userId: "u-1" }) },
      );
      expect(res.status).toBe(403);
    });
  });

  // Branche webhook §5.18.4 testée en détail dans `[userId]-webhook.test.ts`.
  test("PATCH 400 si workspaceId manquant — court-circuit avant DB", async () => {
    requireAdminMock.mockResolvedValue({
      ctx: {
        userId: "admin-1",
        email: "a@v.site",
        tenantId: "t-1",
        tenantOwnerId: "admin-1",
        isAdmin: true,
        activeWorkspaceId: null,
        workspaces: [],
      },
    });
    const res = await PATCH(
      makeRequest("/api/admin/members/u-1", {
        method: "PATCH",
        body: { role: "admin" },
      }),
      { params: Promise.resolve({ userId: "u-1" }) },
    );
    expect(res.status).toBe(400);
    expect(emitHubWebhookAsyncMock).not.toHaveBeenCalled();
  });
});
