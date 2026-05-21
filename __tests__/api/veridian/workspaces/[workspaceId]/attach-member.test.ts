/**
 * Tests POST /api/veridian/workspaces/[workspaceId]/attach-member (§5.22 v1.5).
 *
 * Couvre :
 *  - HMAC invalide / absent → 401 (avant tout hit DB)
 *  - drift timestamp > 5min → 401
 *  - body invalide → 400 invalid_body
 *  - role invalide → 400 invalid_body (Zod)
 *  - workspaceId pas UUID → 404 workspace_not_found (pas leak)
 *  - workspace inconnu → 404 workspace_not_found (après HMAC OK)
 *  - tenant deleted → 404 workspace_not_found
 *  - tenant suspended → 423 workspace_suspended
 *  - succès création → 200 attached, already_member=false, login_url
 *  - idempotence (re-call mêmes params) → 200 already_member=true, pas
 *    de mutation
 *  - conflit role → 200 + UPDATE role + audit role_changed=true
 *  - re-attach après soft-delete → 200 + deletedAt reset
 *  - logAudit appelé sur tous les chemins succès
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-attach-member-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
  process.env.APP_URL = "https://prospection.app.test.local";
});

const mocks = vi.hoisted(() => ({
  workspaceFindFirst: vi.fn(),
  tenantFindUnique: vi.fn(),
  tenantUpdate: vi.fn().mockResolvedValue({}),
  memberFindUnique: vi.fn(),
  memberCreate: vi.fn().mockResolvedValue({}),
  memberUpdate: vi.fn().mockResolvedValue({}),
  resolveOrCreateUserFromHub: vi.fn(),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspace: { findFirst: mocks.workspaceFindFirst },
    tenant: {
      findUnique: mocks.tenantFindUnique,
      update: mocks.tenantUpdate,
    },
    workspaceMember: {
      findUnique: mocks.memberFindUnique,
      create: mocks.memberCreate,
      update: mocks.memberUpdate,
    },
  },
}));

vi.mock("@/lib/hub/identity", () => ({
  resolveOrCreateUserFromHub: mocks.resolveOrCreateUserFromHub,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

import { POST } from "@/app/api/veridian/workspaces/[workspaceId]/attach-member/route";
import { makeRequest, readJson } from "../../../_helpers";

const SECRET = "test-attach-member-secret";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const HUB_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCAL_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function signed(body: object, opts: { driftMs?: number; badSig?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const ts = Date.now() + (opts.driftMs ?? 0);
  const sig = opts.badSig
    ? "00".repeat(32)
    : createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  return {
    raw,
    headers: {
      "x-veridian-timestamp": String(ts),
      "x-veridian-hub-signature": sig,
    },
  };
}

function req(workspaceId: string, raw: string, headers: Record<string, string>) {
  return makeRequest(
    `/api/veridian/workspaces/${workspaceId}/attach-member`,
    { method: "POST", headers, body: raw },
  );
}

const validBody = {
  hub_user_id: HUB_USER_ID,
  hub_user_email: "alice@example.com",
  role: "member" as const,
  invitation_id: "inv_xyz",
};

const ctx = (workspaceId: string) => ({
  params: Promise.resolve({ workspaceId }),
});

describe("POST /api/veridian/workspaces/[workspaceId]/attach-member", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantUpdate.mockResolvedValue({});
    mocks.memberCreate.mockResolvedValue({});
    mocks.memberUpdate.mockResolvedValue({});
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.resolveOrCreateUserFromHub.mockResolvedValue({
      id: LOCAL_USER_ID,
      createdByHub: false,
      hubUserIdConflict: false,
    });
  });

  test("401 Unauthorized si HMAC absent — pas de hit DB", async () => {
    const r = makeRequest(
      `/api/veridian/workspaces/${WORKSPACE_ID}/attach-member`,
      { method: "POST", body: validBody },
    );
    const res = await POST(r, ctx(WORKSPACE_ID));
    expect(res.status).toBe(401);
    expect(mocks.workspaceFindFirst).not.toHaveBeenCalled();
    expect(mocks.resolveOrCreateUserFromHub).not.toHaveBeenCalled();
  });

  test("401 Invalid signature si HMAC bidon", async () => {
    const { raw, headers } = signed(validBody, { badSig: true });
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Invalid signature");
  });

  test("401 si drift timestamp > 5min", async () => {
    const { raw, headers } = signed(validBody, { driftMs: -6 * 60 * 1000 });
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Timestamp expired or invalid");
  });

  test("400 invalid_body si role inconnu (Zod)", async () => {
    const { raw, headers } = signed({ ...validBody, role: "viewer" });
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("invalid_body");
    expect(mocks.workspaceFindFirst).not.toHaveBeenCalled();
  });

  test("400 invalid_body si hub_user_id pas UUID", async () => {
    const { raw, headers } = signed({ ...validBody, hub_user_id: "not-uuid" });
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(400);
  });

  test("400 invalid_body si email mal formé", async () => {
    const { raw, headers } = signed({
      ...validBody,
      hub_user_email: "not-an-email",
    });
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(400);
  });

  test("404 workspace_not_found si workspaceId pas UUID — pas de hit Prisma", async () => {
    const { raw, headers } = signed(validBody);
    const res = await POST(req("not-uuid", raw, headers), ctx("not-uuid"));
    expect(res.status).toBe(404);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("workspace_not_found");
    expect(mocks.workspaceFindFirst).not.toHaveBeenCalled();
  });

  test("404 workspace_not_found si workspace absent en DB", async () => {
    mocks.workspaceFindFirst.mockResolvedValueOnce(null);
    const { raw, headers } = signed(validBody);
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(404);
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
    expect(mocks.resolveOrCreateUserFromHub).not.toHaveBeenCalled();
  });

  test("404 workspace_not_found si tenant soft-deleted", async () => {
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: WORKSPACE_ID,
      tenantId: TENANT_ID,
    });
    mocks.tenantFindUnique.mockResolvedValueOnce({
      status: "active",
      deletedAt: new Date(),
    });
    const { raw, headers } = signed(validBody);
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(404);
  });

  test("423 workspace_suspended si tenant suspendu", async () => {
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: WORKSPACE_ID,
      tenantId: TENANT_ID,
    });
    mocks.tenantFindUnique.mockResolvedValueOnce({
      status: "suspended",
      deletedAt: null,
    });
    const { raw, headers } = signed(validBody);
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(423);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("workspace_suspended");
    expect(mocks.resolveOrCreateUserFromHub).not.toHaveBeenCalled();
  });

  test("200 succès création — attached=true, already_member=false, login_url valide, audit", async () => {
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: WORKSPACE_ID,
      tenantId: TENANT_ID,
    });
    mocks.tenantFindUnique.mockResolvedValueOnce({
      status: "active",
      deletedAt: null,
    });
    mocks.memberFindUnique.mockResolvedValueOnce(null);

    const { raw, headers } = signed(validBody);
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      attached: boolean;
      already_member: boolean;
      member_id: string;
      workspace_id: string;
      role: string;
      login_url: string;
      expires_at: string;
    };
    expect(body.attached).toBe(true);
    expect(body.already_member).toBe(false);
    expect(body.member_id).toBe(LOCAL_USER_ID);
    expect(body.workspace_id).toBe(WORKSPACE_ID);
    expect(body.role).toBe("member");
    expect(body.login_url).toMatch(
      /^https:\/\/prospection\.app\.test\.local\/api\/auth\/token\?t=[a-f0-9]{64}$/,
    );

    expect(mocks.memberCreate).toHaveBeenCalledOnce();
    expect(mocks.memberUpdate).not.toHaveBeenCalled();
    expect(mocks.tenantUpdate).toHaveBeenCalledOnce();
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "hub",
        action: "workspace.member.attached_via_hub",
        tenantId: TENANT_ID,
        targetId: LOCAL_USER_ID,
        metadata: expect.objectContaining({
          hub_user_id: HUB_USER_ID,
          invitation_id: "inv_xyz",
          role: "member",
          already_member: false,
          role_changed: false,
        }),
      }),
    );
  });

  test("200 idempotent — already_member=true si user déjà membre même role, pas de mutation", async () => {
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: WORKSPACE_ID,
      tenantId: TENANT_ID,
    });
    mocks.tenantFindUnique.mockResolvedValueOnce({
      status: "active",
      deletedAt: null,
    });
    mocks.memberFindUnique.mockResolvedValueOnce({
      role: "member",
      deletedAt: null,
    });

    const { raw, headers } = signed(validBody);
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      already_member: boolean;
      role: string;
    };
    expect(body.already_member).toBe(true);
    expect(body.role).toBe("member");
    expect(mocks.memberCreate).not.toHaveBeenCalled();
    expect(mocks.memberUpdate).not.toHaveBeenCalled();
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ already_member: true, role_changed: false }),
      }),
    );
  });

  test("200 conflit role — UPDATE vers le role Hub + audit role_changed=true", async () => {
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: WORKSPACE_ID,
      tenantId: TENANT_ID,
    });
    mocks.tenantFindUnique.mockResolvedValueOnce({
      status: "active",
      deletedAt: null,
    });
    mocks.memberFindUnique.mockResolvedValueOnce({
      role: "member",
      deletedAt: null,
    });

    const { raw, headers } = signed({ ...validBody, role: "admin" });
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      already_member: boolean;
      role: string;
    };
    expect(body.already_member).toBe(false);
    expect(body.role).toBe("admin");
    expect(mocks.memberUpdate).toHaveBeenCalledWith({
      where: {
        workspaceId_userId: {
          workspaceId: WORKSPACE_ID,
          userId: LOCAL_USER_ID,
        },
      },
      data: { role: "admin" },
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ role_changed: true, role: "admin" }),
      }),
    );
  });

  test("200 re-attach après soft-delete : reset deletedAt + role", async () => {
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: WORKSPACE_ID,
      tenantId: TENANT_ID,
    });
    mocks.tenantFindUnique.mockResolvedValueOnce({
      status: "active",
      deletedAt: null,
    });
    mocks.memberFindUnique.mockResolvedValueOnce({
      role: "viewer",
      deletedAt: new Date("2026-01-01"),
    });

    const { raw, headers } = signed({ ...validBody, role: "admin" });
    const res = await POST(req(WORKSPACE_ID, raw, headers), ctx(WORKSPACE_ID));
    expect(res.status).toBe(200);
    expect(mocks.memberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "admin",
          deletedAt: null,
        }),
      }),
    );
  });
});
