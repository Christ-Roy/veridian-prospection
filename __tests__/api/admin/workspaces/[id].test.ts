/**
 * Tests des routes /api/admin/workspaces/[id] (PATCH rename, DELETE).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireAdminMock, prismaMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  prismaMock: {
    workspace: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireAdmin: requireAdminMock,
  invalidateAllUserContexts: vi.fn(),
}));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    workspace = prismaMock.workspace;
  }
  return { PrismaClient };
});

import { PATCH, DELETE } from "@/app/api/admin/workspaces/[id]/route";
import { makeRequest, makeForbidden } from "../../_helpers";

describe("/api/admin/workspaces/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("PATCH", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await PATCH(
        makeRequest("/api/admin/workspaces/w-1", {
          method: "PATCH",
          body: { name: "Renamed" },
        }),
        { params: Promise.resolve({ id: "w-1" }) },
      );
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await DELETE(
        makeRequest("/api/admin/workspaces/w-1", { method: "DELETE" }),
        { params: Promise.resolve({ id: "w-1" }) },
      );
      expect(res.status).toBe(403);
    });
  });
});
