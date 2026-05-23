/**
 * Tests POST /api/tenants/{id}/remove-member — CONTRAT-HUB v1.5 §5.19.
 *
 * Couvre :
 *  - 401 HMAC absent
 *  - 400 ni email ni hub_user_id
 *  - 404 tenant_not_found
 *  - 200 idempotent — user inconnu localement (rien à retirer)
 *  - 409 cannot_remove_owner
 *  - 200 soft delete sur tous workspaces du tenant
 *  - Résolution priorité hub_user_id
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-remove-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
  process.env.HUB_WEBHOOK_DISABLE = "1";
});

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  workspaceFindMany: vi.fn(),
  memberUpdateMany: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: mocks.tenantFindUnique,
      findFirst: mocks.tenantFindFirst,
    },
    user: { findUnique: mocks.userFindUnique },
    workspace: { findMany: mocks.workspaceFindMany },
    workspaceMember: { updateMany: mocks.memberUpdateMany },
  },
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.auditLog,
}));

const { emitWebhookMock } = vi.hoisted(() => ({
  emitWebhookMock: vi.fn(),
}));
vi.mock("@/lib/hub/webhooks", () => ({
  emitHubWebhookAsync: emitWebhookMock,
}));

import { POST } from "@/app/api/tenants/[id]/remove-member/route";
import { makeRequest, readJson } from "../../_helpers";

const SECRET = "test-remove-secret";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const HUB_USER_ID = "22222222-2222-4222-8222-222222222222";
const LOCAL_USER_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_USER_ID = "44444444-4444-4444-8444-444444444444";

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
  return makeRequest(`/api/tenants/${tenantId}/remove-member`, {
    method: "POST",
    headers,
    body: raw,
  });
}

function ctx(tenantId = TENANT_ID) {
  return { params: Promise.resolve({ id: tenantId }) };
}

describe("POST /api/tenants/[id]/remove-member", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("401 sans HMAC", async () => {
    const r = makeRequest(`/api/tenants/${TENANT_ID}/remove-member`, {
      method: "POST",
      body: { user_email: "valid@example.com" },
    });
    expect((await POST(r, ctx())).status).toBe(401);
  });

  test("400 invalid_body si ni email ni hub_user_id", async () => {
    const { raw, headers } = signed({});
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(400);
  });

  test("404 tenant_not_found", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({ user_email: "valid@example.com" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(404);
  });

  test("200 idempotent si user inconnu — affected_workspaces=0", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: OWNER_USER_ID,
    });
    mocks.userFindUnique.mockResolvedValueOnce(null);

    const { raw, headers } = signed({ user_email: "ghost@example.com" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      removed: boolean;
      affected_workspaces: number;
    };
    expect(body.removed).toBe(true);
    expect(body.affected_workspaces).toBe(0);
    expect(mocks.memberUpdateMany).not.toHaveBeenCalled();
  });

  test("409 cannot_remove_owner", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: OWNER_USER_ID,
    });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: OWNER_USER_ID,
      email: "owner@example.com",
    });

    const { raw, headers } = signed({ user_email: "owner@example.com" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("cannot_remove_owner");
    expect(mocks.memberUpdateMany).not.toHaveBeenCalled();
  });

  test("200 soft delete sur tous workspaces du tenant", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: OWNER_USER_ID,
    });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      email: "bob@example.com",
    });
    mocks.workspaceFindMany.mockResolvedValueOnce([
      { id: "ws-1" },
      { id: "ws-2" },
    ]);
    mocks.memberUpdateMany.mockResolvedValueOnce({ count: 2 });

    const { raw, headers } = signed({ user_email: "bob@example.com" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { affected_workspaces: number };
    expect(body.affected_workspaces).toBe(2);
    expect(mocks.memberUpdateMany).toHaveBeenCalledOnce();
    const args = mocks.memberUpdateMany.mock.calls[0][0];
    expect(args.where.userId).toBe(LOCAL_USER_ID);
    expect(args.where.workspaceId.in).toEqual(["ws-1", "ws-2"]);
    expect(args.data.deletedAt).toBeInstanceOf(Date);

    // §7.1 v1.4 — tenant.member_removed émis seulement si au moins une
    // membership a bien été retirée (skip si already-removed).
    expect(emitWebhookMock).toHaveBeenCalledOnce();
    const [event, id, data] = emitWebhookMock.mock.calls[0];
    expect(event).toBe("tenant.member_removed");
    expect(id).toBe(TENANT_ID);
    expect(data.user_id).toBe(LOCAL_USER_ID);
    expect(data.email).toBe("bob@example.com");
    expect(data.affected_workspaces).toBe(2);
  });

  test("§7.1 v1.4 — pas d'event si already-removed (count=0)", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: OWNER_USER_ID,
    });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      email: "bob@example.com",
    });
    mocks.workspaceFindMany.mockResolvedValueOnce([{ id: "ws-1" }]);
    mocks.memberUpdateMany.mockResolvedValueOnce({ count: 0 });

    const { raw, headers } = signed({ user_email: "bob@example.com" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    // Aucun event : already-removed = noop côté Hub.
    expect(emitWebhookMock).not.toHaveBeenCalled();
  });

  test("priorité hub_user_id sur email", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: OWNER_USER_ID,
    });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      email: "bob@example.com",
    });
    mocks.workspaceFindMany.mockResolvedValueOnce([{ id: "ws-1" }]);
    mocks.memberUpdateMany.mockResolvedValueOnce({ count: 1 });

    const { raw, headers } = signed({
      hub_user_id: HUB_USER_ID,
      user_email: "different@example.com",
    });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { hubUserId: HUB_USER_ID },
      select: { id: true, email: true },
    });
  });

  test("T7 — accepte tenant_id en email owner (lookup via users.email)", async () => {
    // 1er user.findUnique = lookup owner pour résoudre tenant
    mocks.userFindUnique.mockResolvedValueOnce({ id: OWNER_USER_ID });
    mocks.tenantFindFirst.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: OWNER_USER_ID,
    });
    // 2e user.findUnique = lookup user à retirer (par email)
    mocks.userFindUnique.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      email: "bob@example.com",
    });
    mocks.workspaceFindMany.mockResolvedValueOnce([{ id: "ws-1" }]);
    mocks.memberUpdateMany.mockResolvedValueOnce({ count: 1 });

    const { raw, headers } = signed({ user_email: "bob@example.com" });
    const res = await POST(req(raw, headers, "owner@example.com"), ctx("owner@example.com"));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      tenant_id: string;
      affected_workspaces: number;
    };
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.affected_workspaces).toBe(1);
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
    expect(mocks.tenantFindFirst).toHaveBeenCalled();
  });
});
