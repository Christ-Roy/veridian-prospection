/**
 * Tests de DELETE /api/admin/invitations/[id] (revoke invitation, idempotent).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireAdminMock, revokeInvitationMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  revokeInvitationMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/invitations", () => ({ revokeInvitation: revokeInvitationMock }));

import { DELETE } from "@/app/api/admin/invitations/[id]/route";
import { makeUserContext, makeForbidden } from "../../_helpers";

describe("DELETE /api/admin/invitations/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 403 for non-admin", async () => {
    requireAdminMock.mockResolvedValue(await makeForbidden());
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(403);
  });

  test("returns 400 on invalid id", async () => {
    requireAdminMock.mockResolvedValue({ ctx: makeUserContext({ isAdmin: true }) });
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 204 on successful revoke", async () => {
    requireAdminMock.mockResolvedValue({
      ctx: makeUserContext({ isAdmin: true, tenantId: "t-1" }),
    });
    revokeInvitationMock.mockResolvedValue(undefined);
    const res = await DELETE(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "42" }),
    });
    expect(res.status).toBe(204);
    expect(revokeInvitationMock).toHaveBeenCalledWith(42, "t-1");
  });
});
