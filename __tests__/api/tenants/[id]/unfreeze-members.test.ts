/**
 * Tests POST /api/tenants/{id}/unfreeze-members — CONTRAT-HUB v1.5 §5.21.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-unfreeze-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
  process.env.HUB_WEBHOOK_DISABLE = "1";
});

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  workspaceFindMany: vi.fn(),
  memberUpdateMany: vi.fn(),
  auditLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
    user: { findMany: mocks.userFindMany },
    workspace: { findMany: mocks.workspaceFindMany },
    workspaceMember: { updateMany: mocks.memberUpdateMany },
  },
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.auditLog,
}));

import { POST as UNFREEZE } from "@/app/api/tenants/[id]/unfreeze-members/route";
import { makeRequest, readJson } from "../../_helpers";

const SECRET = "test-unfreeze-secret";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

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

function req(raw: string, headers: Record<string, string>) {
  return makeRequest(`/api/tenants/${TENANT_ID}/unfreeze-members`, {
    method: "POST",
    headers,
    body: raw,
  });
}

function ctx(tenantId = TENANT_ID) {
  return { params: Promise.resolve({ id: tenantId }) };
}

describe("POST /api/tenants/[id]/unfreeze-members", () => {
  beforeEach(() => vi.clearAllMocks());

  test("401 sans HMAC", async () => {
    const r = makeRequest(`/api/tenants/${TENANT_ID}/unfreeze-members`, {
      method: "POST",
      body: { user_emails: ["a@b.cd"] },
    });
    expect((await UNFREEZE(r, ctx())).status).toBe(401);
  });

  test("404 tenant_not_found", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({ user_emails: ["bob@example.com"] });
    expect((await UNFREEZE(req(raw, headers), ctx())).status).toBe(404);
  });

  test("200 unset frozenAt sur tous workspaces", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    mocks.userFindMany.mockResolvedValueOnce([
      { id: "u-bob", email: "bob@example.com" },
    ]);
    mocks.workspaceFindMany.mockResolvedValueOnce([{ id: "ws-1" }]);
    mocks.memberUpdateMany.mockResolvedValueOnce({ count: 1 });

    const { raw, headers } = signed({ user_emails: ["bob@example.com"] });
    const res = await UNFREEZE(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { affected_members: number };
    expect(body.affected_members).toBe(1);
    const args = mocks.memberUpdateMany.mock.calls[0][0];
    expect(args.data.frozenAt).toBeNull();
    expect(args.where.frozenAt).toEqual({ not: null });
  });

  test("idempotent — count=0 si rien à dégeler", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    mocks.userFindMany.mockResolvedValueOnce([
      { id: "u-bob", email: "bob@example.com" },
    ]);
    mocks.workspaceFindMany.mockResolvedValueOnce([{ id: "ws-1" }]);
    mocks.memberUpdateMany.mockResolvedValueOnce({ count: 0 });

    const { raw, headers } = signed({ user_emails: ["bob@example.com"] });
    const res = await UNFREEZE(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { affected_members: number };
    expect(body.affected_members).toBe(0);
  });
});
