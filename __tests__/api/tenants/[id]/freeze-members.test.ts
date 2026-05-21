/**
 * Tests POST /api/tenants/{id}/freeze-members — CONTRAT-HUB v1.5 §5.21.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-freeze-secret";
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

import { POST as FREEZE } from "@/app/api/tenants/[id]/freeze-members/route";
import { makeRequest, readJson } from "../../_helpers";

const SECRET = "test-freeze-secret";
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
  return makeRequest(`/api/tenants/${TENANT_ID}/freeze-members`, {
    method: "POST",
    headers,
    body: raw,
  });
}

function ctx(tenantId = TENANT_ID) {
  return { params: Promise.resolve({ id: tenantId }) };
}

describe("POST /api/tenants/[id]/freeze-members", () => {
  beforeEach(() => vi.clearAllMocks());

  test("401 sans HMAC", async () => {
    const r = makeRequest(`/api/tenants/${TENANT_ID}/freeze-members`, {
      method: "POST",
      body: { user_emails: ["a@b.cd"] },
    });
    expect((await FREEZE(r, ctx())).status).toBe(401);
  });

  test("400 invalid_body si user_emails vide", async () => {
    const { raw, headers } = signed({ user_emails: [] });
    expect((await FREEZE(req(raw, headers), ctx())).status).toBe(400);
  });

  test("404 tenant_not_found", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({ user_emails: ["bob@example.com"] });
    expect((await FREEZE(req(raw, headers), ctx())).status).toBe(404);
  });

  test("200 freeze applique frozenAt sur tous workspaces du tenant", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    mocks.userFindMany.mockResolvedValueOnce([
      { id: "u-bob", email: "bob@example.com" },
    ]);
    mocks.workspaceFindMany.mockResolvedValueOnce([
      { id: "ws-1" },
      { id: "ws-2" },
    ]);
    mocks.memberUpdateMany.mockResolvedValueOnce({ count: 2 });

    const { raw, headers } = signed({ user_emails: ["bob@example.com"] });
    const res = await FREEZE(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      frozen_emails: string[];
      affected_members: number;
    };
    expect(body.frozen_emails).toEqual(["bob@example.com"]);
    expect(body.affected_members).toBe(2);
    const args = mocks.memberUpdateMany.mock.calls[0][0];
    expect(args.data.frozenAt).toBeInstanceOf(Date);
    expect(args.where.frozenAt).toBeNull();
  });

  test("200 affected=0 si users tous inconnus", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: TENANT_ID });
    mocks.userFindMany.mockResolvedValueOnce([]);
    mocks.workspaceFindMany.mockResolvedValueOnce([{ id: "ws-1" }]);

    const { raw, headers } = signed({ user_emails: ["ghost@example.com"] });
    const res = await FREEZE(req(raw, headers), ctx());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { affected_members: number };
    expect(body.affected_members).toBe(0);
    expect(mocks.memberUpdateMany).not.toHaveBeenCalled();
  });
});
