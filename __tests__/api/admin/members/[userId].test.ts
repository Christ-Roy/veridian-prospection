/**
 * Tests des routes /api/admin/members/[userId] (PATCH role, DELETE remove).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireAdminMock, prismaMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  prismaMock: {
    workspaceMember: {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    workspace: { findFirst: vi.fn(), findMany: vi.fn() },
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
  }
  return { PrismaClient };
});

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
});
