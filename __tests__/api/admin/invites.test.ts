/**
 * Tests des routes /api/admin/invites (GET list, POST create magic-link).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireAdminMock, prismaMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  prismaMock: {
    magicLink: { create: vi.fn(), findMany: vi.fn() },
    workspace: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/lib/auth/user-context", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    magicLink = prismaMock.magicLink;
    workspace = prismaMock.workspace;
    $queryRaw = prismaMock.$queryRaw;
    $queryRawUnsafe = prismaMock.$queryRawUnsafe;
  }
  return { PrismaClient };
});

import { GET, POST } from "@/app/api/admin/invites/route";
import { makeRequest, makeUserContext, makeForbidden, readJson } from "../_helpers";

describe("/api/admin/invites", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await GET();
      expect(res.status).toBe(403);
    });

    test("returns list of pending invites for admin", async () => {
      requireAdminMock.mockResolvedValue({ ctx: makeUserContext({ isAdmin: true }) });
      prismaMock.$queryRaw.mockResolvedValue([]);
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as unknown;
      expect(Array.isArray(body) || typeof body === "object").toBe(true);
    });
  });

  describe("POST", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const req = makeRequest("/api/admin/invites", {
        method: "POST",
        body: { email: "x@y.fr", workspaceId: "w-1" },
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    test("returns 400 when email is invalid", async () => {
      requireAdminMock.mockResolvedValue({ ctx: makeUserContext({ isAdmin: true }) });
      const req = makeRequest("/api/admin/invites", {
        method: "POST",
        body: { email: "notanemail", workspaceId: "w-1" },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });
});
