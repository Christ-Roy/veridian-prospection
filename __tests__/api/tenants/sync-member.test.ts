/**
 * Tests POST /api/tenants/{id}/sync-member — CONTRAT-HUB v1.5 §5.18.3.
 *
 * Couvre :
 *  - 401 HMAC absent / bidon
 *  - 422 email_invalid
 *  - 400 invalid_body (hub_user_id manquant)
 *  - 404 tenant_not_found (UUID invalide ou tenant absent)
 *  - 200 create — workspace par défaut existant
 *  - 200 create — workspace par défaut absent (cas pathologique → création)
 *  - 200 idempotent — déjà membre, role identique (pas d'update)
 *  - 200 upgrade member → admin
 *  - 200 jamais downgrade admin → member
 *  - 200 restore après soft-delete
 *  - visibility_scope=own par défaut sur nouveau membre
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac, randomUUID } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-sync-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
  process.env.HUB_WEBHOOK_DISABLE = "1";
});

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  workspaceFindFirst: vi.fn(),
  workspaceCreate: vi.fn(),
  memberFindUnique: vi.fn(),
  memberCreate: vi.fn(),
  memberUpdate: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
    workspace: {
      findFirst: mocks.workspaceFindFirst,
      create: mocks.workspaceCreate,
    },
    workspaceMember: {
      findUnique: mocks.memberFindUnique,
      create: mocks.memberCreate,
      update: mocks.memberUpdate,
    },
  },
}));

const { resolveOrCreateUserFromHubMock } = vi.hoisted(() => ({
  resolveOrCreateUserFromHubMock: vi.fn(),
}));
vi.mock("@/lib/hub/identity", () => ({
  resolveOrCreateUserFromHub: resolveOrCreateUserFromHubMock,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.auditLog,
}));

import { POST } from "@/app/api/tenants/[id]/sync-member/route";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-sync-secret";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const HUB_USER_ID = "22222222-2222-4222-8222-222222222222";
const LOCAL_USER_ID = "33333333-3333-4333-8333-333333333333";
const WS_ID = "44444444-4444-4444-8444-444444444444";

function signed(body: object) {
  const raw = JSON.stringify(body);
  const ts = Date.now();
  const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  return {
    raw,
    headers: {
      "x-veridian-timestamp": String(ts),
      "x-veridian-hub-signature": sig,
    },
  };
}

function req(raw: string, headers: Record<string, string>, tenantId = TENANT_ID) {
  return makeRequest(`/api/tenants/${tenantId}/sync-member`, {
    method: "POST",
    headers,
    body: raw,
  });
}

function ctx(tenantId = TENANT_ID) {
  return { params: Promise.resolve({ id: tenantId }) };
}

const validBody = {
  user_email: "bob@example.com",
  hub_user_id: HUB_USER_ID,
  role: "member" as const,
};

describe("POST /api/tenants/[id]/sync-member", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrCreateUserFromHubMock.mockReset();
  });

  test("401 Unauthorized si HMAC absent", async () => {
    const r = makeRequest(`/api/tenants/${TENANT_ID}/sync-member`, {
      method: "POST",
      body: validBody,
    });
    const res = await POST(r, ctx());
    expect(res.status).toBe(401);
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("422 email_invalid", async () => {
    const { raw, headers } = signed({ ...validBody, user_email: "not-an-email" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(422);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("email_invalid");
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("400 invalid_body si hub_user_id manquant", async () => {
    const { raw, headers } = signed({
      user_email: "valid@example.com",
      role: "member",
    });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  test("404 tenant_not_found si UUID invalide (court-circuit avant DB)", async () => {
    const { raw, headers } = signed(validBody);
    const res = await POST(req(raw, headers, "not-a-uuid"), ctx("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("404 tenant_not_found si tenant absent en DB", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed(validBody);
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(404);
    expect(mocks.tenantFindUnique).toHaveBeenCalledOnce();
  });

  test("200 create — workspace par défaut existant + visibility=own par défaut", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    resolveOrCreateUserFromHubMock.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      createdByHub: true,
      hubUserIdConflict: false,
    });
    mocks.workspaceFindFirst.mockResolvedValueOnce({ id: WS_ID });
    mocks.memberFindUnique.mockResolvedValueOnce(null);
    mocks.memberCreate.mockResolvedValueOnce({});

    const { raw, headers } = signed(validBody);
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      synced: boolean;
      app_user_id: string;
      app_role: string;
    };
    expect(body.synced).toBe(true);
    expect(body.app_user_id).toBe(LOCAL_USER_ID);
    expect(body.app_role).toBe("member");

    expect(mocks.memberCreate).toHaveBeenCalledOnce();
    expect(mocks.memberCreate.mock.calls[0][0].data.visibilityScope).toBe("own");
    expect(mocks.workspaceCreate).not.toHaveBeenCalled();
  });

  test("200 create — workspace absent → crée 'default' avec ce user", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    resolveOrCreateUserFromHubMock.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      createdByHub: true,
      hubUserIdConflict: false,
    });
    mocks.workspaceFindFirst.mockResolvedValueOnce(null);
    mocks.workspaceCreate.mockResolvedValueOnce({ id: WS_ID });
    mocks.memberFindUnique.mockResolvedValueOnce(null);
    mocks.memberCreate.mockResolvedValueOnce({});

    const { raw, headers } = signed(validBody);
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    expect(mocks.workspaceCreate).toHaveBeenCalledOnce();
    expect(mocks.workspaceCreate.mock.calls[0][0].data.slug).toBe("default");
    expect(mocks.workspaceCreate.mock.calls[0][0].data.createdBy).toBe(LOCAL_USER_ID);
  });

  test("200 idempotent — déjà membre même role, pas d'update", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    resolveOrCreateUserFromHubMock.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      createdByHub: false,
      hubUserIdConflict: false,
    });
    mocks.workspaceFindFirst.mockResolvedValueOnce({ id: WS_ID });
    mocks.memberFindUnique.mockResolvedValueOnce({
      role: "member",
      deletedAt: null,
    });

    const { raw, headers } = signed(validBody);
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { app_role: string };
    expect(body.app_role).toBe("member");
    expect(mocks.memberUpdate).not.toHaveBeenCalled();
    expect(mocks.memberCreate).not.toHaveBeenCalled();
  });

  test("200 upgrade member → admin", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    resolveOrCreateUserFromHubMock.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      createdByHub: false,
      hubUserIdConflict: false,
    });
    mocks.workspaceFindFirst.mockResolvedValueOnce({ id: WS_ID });
    mocks.memberFindUnique.mockResolvedValueOnce({
      role: "member",
      deletedAt: null,
    });
    mocks.memberUpdate.mockResolvedValueOnce({});

    const { raw, headers } = signed({ ...validBody, role: "admin" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { app_role: string };
    expect(body.app_role).toBe("admin");
    expect(mocks.memberUpdate).toHaveBeenCalledOnce();
    expect(mocks.memberUpdate.mock.calls[0][0].data.role).toBe("admin");
  });

  test("200 JAMAIS downgrade — admin local conservé si Hub envoie member", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    resolveOrCreateUserFromHubMock.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      createdByHub: false,
      hubUserIdConflict: false,
    });
    mocks.workspaceFindFirst.mockResolvedValueOnce({ id: WS_ID });
    mocks.memberFindUnique.mockResolvedValueOnce({
      role: "admin",
      deletedAt: null,
    });

    const { raw, headers } = signed({ ...validBody, role: "member" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { app_role: string };
    expect(body.app_role).toBe("admin");
    expect(mocks.memberUpdate).not.toHaveBeenCalled();
  });

  test("200 restore — relève deletedAt après soft-delete", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    resolveOrCreateUserFromHubMock.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      createdByHub: false,
      hubUserIdConflict: false,
    });
    mocks.workspaceFindFirst.mockResolvedValueOnce({ id: WS_ID });
    mocks.memberFindUnique.mockResolvedValueOnce({
      role: "member",
      deletedAt: new Date(),
    });
    mocks.memberUpdate.mockResolvedValueOnce({});

    const { raw, headers } = signed(validBody);
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    expect(mocks.memberUpdate).toHaveBeenCalledOnce();
    expect(mocks.memberUpdate.mock.calls[0][0].data.deletedAt).toBeNull();
  });
});
