/**
 * Tests POST /api/tenants/{id}/restore-member — CONTRAT-HUB v1.5 §5.20.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-restore-secret";
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

import { POST } from "@/app/api/tenants/[id]/restore-member/route";
import { makeRequest, readJson } from "../../_helpers";

const SECRET = "test-restore-secret";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const LOCAL_USER_ID = "33333333-3333-4333-8333-333333333333";

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
  return makeRequest(`/api/tenants/${tenantId}/restore-member`, {
    method: "POST",
    headers,
    body: raw,
  });
}

function ctx(tenantId = TENANT_ID) {
  return { params: Promise.resolve({ id: tenantId }) };
}

describe("POST /api/tenants/[id]/restore-member", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("401 sans HMAC", async () => {
    const r = makeRequest(`/api/tenants/${TENANT_ID}/restore-member`, {
      method: "POST",
      body: { user_email: "valid@example.com" },
    });
    expect((await POST(r, ctx())).status).toBe(401);
  });

  test("404 tenant_not_found", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({ user_email: "valid@example.com" });
    expect((await POST(req(raw, headers), ctx())).status).toBe(404);
  });

  test("200 idempotent si user inconnu", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    mocks.userFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({ user_email: "ghost@example.com" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      restored: boolean;
      affected_workspaces: number;
    };
    expect(body.restored).toBe(true);
    expect(body.affected_workspaces).toBe(0);
  });

  test("200 unset deletedAt sur tous workspaces du tenant", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
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
    const args = mocks.memberUpdateMany.mock.calls[0][0];
    expect(args.data.deletedAt).toBeNull();
    expect(args.where.deletedAt).toEqual({ not: null });
  });

  test("200 idempotent — rien à restaurer", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      email: "bob@example.com",
    });
    mocks.workspaceFindMany.mockResolvedValueOnce([{ id: "ws-1" }]);
    mocks.memberUpdateMany.mockResolvedValueOnce({ count: 0 });

    const { raw, headers } = signed({ user_email: "bob@example.com" });
    const res = await POST(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { affected_workspaces: number };
    expect(body.affected_workspaces).toBe(0);
  });

  test("T7 — accepte tenant_id en email owner", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ id: "owner-uid" });
    mocks.tenantFindFirst.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: "owner-uid",
    });
    mocks.userFindUnique.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      email: "bob@example.com",
    });
    mocks.workspaceFindMany.mockResolvedValueOnce([{ id: "ws-1" }]);
    mocks.memberUpdateMany.mockResolvedValueOnce({ count: 1 });

    const { raw, headers } = signed({ user_email: "bob@example.com" });
    const res = await POST(
      req(raw, headers, "owner@example.com"),
      ctx("owner@example.com"),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { tenant_id: string };
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
    expect(mocks.tenantFindFirst).toHaveBeenCalled();
  });
});
