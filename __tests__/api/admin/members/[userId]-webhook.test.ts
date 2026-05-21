/**
 * Tests du webhook tenant.member_role_changed émis depuis PATCH
 * /api/admin/members/[userId] — CONTRAT-HUB v1.5 §5.18.4.
 *
 * Couvre :
 *  - Émission webhook quand role change effectivement
 *  - Pas d'émission si role identique (no-op silencieux)
 *  - Payload contient user_email, old_role, new_role, workspace_id, changed_by
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.HUB_WEBHOOK_DISABLE = "1";
});

const { requireAdminMock, prismaMock, emitHubWebhookAsyncMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  emitHubWebhookAsyncMock: vi.fn(),
  prismaMock: {
    workspaceMember: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    workspace: { findFirst: vi.fn() },
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

import { PATCH } from "@/app/api/admin/members/[userId]/route";
import { makeRequest } from "../../_helpers";

const TENANT_ID = "tenant-1";
const ADMIN_USER_ID = "admin-1";
const TARGET_USER_ID = "user-2";
const WORKSPACE_ID = "ws-1";

function adminCtx() {
  return {
    ctx: {
      userId: ADMIN_USER_ID,
      email: "admin@example.com",
      tenantId: TENANT_ID,
      tenantOwnerId: ADMIN_USER_ID,
      isAdmin: true,
      activeWorkspaceId: WORKSPACE_ID,
      workspaces: [],
    },
  };
}

describe("PATCH /api/admin/members/[userId] — webhook role_changed §5.18.4", () => {
  beforeEach(() => vi.clearAllMocks());

  test("émet webhook quand le role change (member → admin)", async () => {
    requireAdminMock.mockResolvedValue(adminCtx());
    prismaMock.workspace.findFirst.mockResolvedValue({ id: WORKSPACE_ID });
    prismaMock.workspaceMember.findUnique.mockResolvedValue({
      role: "member",
      visibilityScope: "own",
    });
    prismaMock.workspaceMember.upsert.mockResolvedValue({});
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ email: "bob@example.com" }) // target
      .mockResolvedValueOnce({ email: "admin@example.com" }); // actor

    const res = await PATCH(
      makeRequest(`/api/admin/members/${TARGET_USER_ID}`, {
        method: "PATCH",
        body: { workspaceId: WORKSPACE_ID, role: "admin" },
      }),
      { params: Promise.resolve({ userId: TARGET_USER_ID }) },
    );
    expect(res.status).toBe(200);

    expect(emitHubWebhookAsyncMock).toHaveBeenCalledOnce();
    const call = emitHubWebhookAsyncMock.mock.calls[0];
    expect(call[0]).toBe("tenant.member_role_changed");
    expect(call[1]).toBe(TENANT_ID);
    expect(call[2]).toMatchObject({
      user_email: "bob@example.com",
      old_role: "member",
      new_role: "admin",
      workspace_id: WORKSPACE_ID,
      visibility_scope: "own",
      changed_by: "admin@example.com",
    });
  });

  test("PAS d'émission si role identique (idempotent silencieux)", async () => {
    requireAdminMock.mockResolvedValue(adminCtx());
    prismaMock.workspace.findFirst.mockResolvedValue({ id: WORKSPACE_ID });
    prismaMock.workspaceMember.findUnique.mockResolvedValue({
      role: "admin",
      visibilityScope: "all",
    });
    prismaMock.workspaceMember.upsert.mockResolvedValue({});

    const res = await PATCH(
      makeRequest(`/api/admin/members/${TARGET_USER_ID}`, {
        method: "PATCH",
        body: { workspaceId: WORKSPACE_ID, role: "admin" },
      }),
      { params: Promise.resolve({ userId: TARGET_USER_ID }) },
    );
    expect(res.status).toBe(200);
    expect(emitHubWebhookAsyncMock).not.toHaveBeenCalled();
  });

  test("émet webhook avec old_role=null quand membre nouveau (upsert create)", async () => {
    requireAdminMock.mockResolvedValue(adminCtx());
    prismaMock.workspace.findFirst.mockResolvedValue({ id: WORKSPACE_ID });
    prismaMock.workspaceMember.findUnique.mockResolvedValue(null);
    prismaMock.workspaceMember.upsert.mockResolvedValue({});
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ email: "bob@example.com" })
      .mockResolvedValueOnce({ email: "admin@example.com" });

    const res = await PATCH(
      makeRequest(`/api/admin/members/${TARGET_USER_ID}`, {
        method: "PATCH",
        body: { workspaceId: WORKSPACE_ID, role: "member" },
      }),
      { params: Promise.resolve({ userId: TARGET_USER_ID }) },
    );
    expect(res.status).toBe(200);
    expect(emitHubWebhookAsyncMock).toHaveBeenCalledOnce();
    const payload = emitHubWebhookAsyncMock.mock.calls[0][2];
    expect(payload.old_role).toBeNull();
    expect(payload.new_role).toBe("member");
  });
});
