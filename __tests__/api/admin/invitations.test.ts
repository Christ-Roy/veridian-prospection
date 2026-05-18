/**
 * Tests des routes /api/admin/invitations (GET list + POST create).
 *
 * Auth: requireAdmin — 403 si non-admin testé via court-circuit.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireAdminMock, listInvitationsByTenantMock, createInvitationMock } = vi.hoisted(
  () => ({
    requireAdminMock: vi.fn(),
    listInvitationsByTenantMock: vi.fn(),
    createInvitationMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth/user-context", () => ({
  requireAdmin: requireAdminMock,
}));
vi.mock("@/lib/invitations", () => ({
  listInvitationsByTenant: listInvitationsByTenantMock,
  createInvitation: createInvitationMock,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { workspace: { findFirst: vi.fn() } },
}));

import { GET, POST } from "@/app/api/admin/invitations/route";
import { makeRequest, makeUserContext, makeForbidden, readJson } from "../_helpers";

describe("/api/admin/invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await GET(makeRequest("/api/admin/invitations"));
      expect(res.status).toBe(403);
    });

    test("returns invitations list for admin", async () => {
      requireAdminMock.mockResolvedValue({
        ctx: makeUserContext({ isAdmin: true, tenantId: "t-1" }),
      });
      listInvitationsByTenantMock.mockResolvedValue([
        {
          id: 1,
          email: "x@y.fr",
          role: "member",
          workspace_id: "w-1",
          token: "tok",
          expires_at: new Date().toISOString(),
          accepted_at: null,
          revoked_at: null,
          created_at: new Date().toISOString(),
        },
      ]);
      const res = await GET(makeRequest("/api/admin/invitations?status=pending"));
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as { invitations: Array<Record<string, unknown>> };
      expect(body.invitations).toHaveLength(1);
      expect(body.invitations[0].email).toBe("x@y.fr");
      expect(listInvitationsByTenantMock).toHaveBeenCalledWith("t-1", { status: "pending" });
    });
  });

  describe("POST", () => {
    test("returns 403 for non-admin", async () => {
      requireAdminMock.mockResolvedValue(await makeForbidden());
      const res = await POST(
        makeRequest("/api/admin/invitations", {
          method: "POST",
          body: { email: "x@y.fr" },
        }),
      );
      expect(res.status).toBe(403);
    });
  });
});
