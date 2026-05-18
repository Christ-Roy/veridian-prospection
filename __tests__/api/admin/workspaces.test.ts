/**
 * Tests des routes /api/admin/workspaces (GET list, POST create).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireAdminMock, prismaMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  prismaMock: {
    workspace: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
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

import { GET, POST } from "@/app/api/admin/workspaces/route";
import { makeRequest, makeUserContext, makeForbidden, readJson } from "../_helpers";

describe("/api/admin/workspaces", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await GET();
      expect(res.status).toBe(403);
    });

    test("returns empty list when no workspaces", async () => {
      requireAdminMock.mockResolvedValue({
        ctx: makeUserContext({ isAdmin: true, tenantId: "t-1" }),
      });
      prismaMock.workspace.findMany.mockResolvedValue([]);
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as unknown[];
      expect(body).toEqual([]);
    });
  });

  describe("POST", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await POST(
        makeRequest("/api/admin/workspaces", {
          method: "POST",
          body: { name: "New" },
        }),
      );
      expect(res.status).toBe(403);
    });
  });
});
