/**
 * Tests GET /api/tenants/{id}/health — contrat §5.5.
 *
 * Couvre :
 *  - 401 si HMAC invalide
 *  - 200 + status=deleted si tenant introuvable (le Hub doit pouvoir noter
 *    qu'un tenant disparu côté app n'est plus health-checkable)
 *  - 200 + magic_link_capable=true si owner attaché + non soft-deleted
 *  - 200 + magic_link_capable=false si pas d'owner attaché
 *  - 200 + magic_link_capable=false si tenant soft-deleted
 *  - 200 + status=suspended si tenant.status='suspended'
 *  - members_count cohérent avec le nombre de membres workspace default
 *  - plan rempli depuis tenant.plan (fallback freemium si raw query échoue)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-health-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantFindFirst: vi.fn(),
  workspaceFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: mocks.tenantFindUnique,
      findFirst: mocks.tenantFindFirst,
    },
    workspace: { findFirst: mocks.workspaceFindFirst },
    user: { findUnique: mocks.userFindUnique },
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));

import { GET } from "@/app/api/tenants/[id]/health/route";
import { makeRequest, readJson } from "../../_helpers";

const SECRET = "test-health-secret";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function signedGet(tenantId: string) {
  const raw = "";
  const ts = Date.now();
  const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  const req = makeRequest(`/api/tenants/${tenantId}/health`, {
    method: "GET",
    headers: {
      "x-veridian-timestamp": String(ts),
      "x-veridian-hub-signature": sig,
    },
  });
  return { req, params: Promise.resolve({ id: tenantId }) };
}

describe("GET /api/tenants/{id}/health", () => {
  beforeEach(() => vi.clearAllMocks());

  test("401 Unauthorized si HMAC absent — pas de query DB", async () => {
    const req = makeRequest("/api/tenants/t-1/health", { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_ID }) });
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Unauthorized");
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("401 Invalid signature avec HMAC bidon", async () => {
    const req = makeRequest("/api/tenants/t-1/health", {
      method: "GET",
      headers: {
        "x-veridian-timestamp": String(Date.now()),
        "x-veridian-hub-signature": "00".repeat(32),
      },
    });
    const res = await GET(req, { params: Promise.resolve({ id: TENANT_ID }) });
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Invalid signature");
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("200 + status=deleted si tenant introuvable", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    const { req, params } = signedGet(TENANT_ID);
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      status: string;
      owner_attached: boolean;
      magic_link_capable: boolean;
    };
    expect(body.status).toBe("deleted");
    expect(body.owner_attached).toBe(false);
    expect(body.magic_link_capable).toBe(false);
  });

  test("200 + magic_link_capable=true si owner attaché et tenant actif", async () => {
    // tenant.findUnique appelé 2× (resolveTenantByIdOrEmail puis route) — mock
    // sans Once pour servir les 2 calls avec le même tenant.
    mocks.tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      status: "active",
      deletedAt: null,
      metadata: null,
    });
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: "ws-1",
      members: [{ userId: "u-1", role: "owner" }],
    });
    mocks.userFindUnique.mockResolvedValueOnce({ email: "owner@example.com" });
    mocks.queryRawUnsafe.mockResolvedValueOnce([{ plan: "pro" }]);
    const { req, params } = signedGet(TENANT_ID);
    const res = await GET(req, { params });
    const body = (await readJson(res)) as {
      status: string;
      owner_attached: boolean;
      owner_email: string | null;
      magic_link_capable: boolean;
      members_count: number;
      plan: string;
    };
    expect(body.status).toBe("active");
    expect(body.owner_attached).toBe(true);
    expect(body.owner_email).toBe("owner@example.com");
    expect(body.magic_link_capable).toBe(true);
    expect(body.members_count).toBe(1);
    expect(body.plan).toBe("pro");
  });

  test("200 + magic_link_capable=false si pas d'owner attaché", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      status: "active",
      deletedAt: null,
      metadata: null,
    });
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: "ws-1",
      members: [],
    });
    mocks.queryRawUnsafe.mockResolvedValueOnce([{ plan: "freemium" }]);
    const { req, params } = signedGet(TENANT_ID);
    const res = await GET(req, { params });
    const body = (await readJson(res)) as {
      owner_attached: boolean;
      magic_link_capable: boolean;
    };
    expect(body.owner_attached).toBe(false);
    expect(body.magic_link_capable).toBe(false);
  });

  test("200 + magic_link_capable=false si tenant soft-deleted", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      status: "active",
      deletedAt: new Date("2026-05-01T00:00:00Z"),
      metadata: null,
    });
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: "ws-1",
      members: [{ userId: "u-1", role: "owner" }],
    });
    mocks.userFindUnique.mockResolvedValueOnce({ email: "owner@example.com" });
    mocks.queryRawUnsafe.mockResolvedValueOnce([{ plan: "pro" }]);
    const { req, params } = signedGet(TENANT_ID);
    const body = (await readJson(await GET(req, { params }))) as {
      status: string;
      magic_link_capable: boolean;
    };
    expect(body.status).toBe("deleted");
    expect(body.magic_link_capable).toBe(false);
  });

  test("200 + status=suspended si tenant.status='suspended'", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      status: "suspended",
      deletedAt: null,
      metadata: { suspendedAt: "2026-05-19T10:00:00Z" },
    });
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: "ws-1",
      members: [{ userId: "u-1", role: "owner" }],
    });
    mocks.userFindUnique.mockResolvedValueOnce({ email: "owner@example.com" });
    mocks.queryRawUnsafe.mockResolvedValueOnce([{ plan: "pro" }]);
    const { req, params } = signedGet(TENANT_ID);
    const body = (await readJson(await GET(req, { params }))) as {
      status: string;
      magic_link_capable: boolean;
    };
    expect(body.status).toBe("suspended");
    // magic_link_capable reste true sur suspended — c'est restore qui le pose à false
    expect(body.magic_link_capable).toBe(true);
  });

  test("T13 — 200 lookup par email owner (tenant_id = email)", async () => {
    // Le Hub legacy peut envoyer `tenant_id: owner@example.com`. La route
    // doit basculer sur user.findUnique → tenant.findFirst (helper T7).
    // 1. resolveTenantByIdOrEmail("owner@example.com") →
    //    user.findUnique({email}) → {id: "owner-uid"}
    //    puis tenant.findFirst({userId}) → {id: TENANT_ID, userId: "owner-uid"}
    mocks.userFindUnique.mockResolvedValueOnce({ id: "owner-uid" });
    mocks.tenantFindFirst.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: "owner-uid",
    });
    // 2. La route appelle prisma.tenant.findUnique(UUID résolu) → cas standard
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: TENANT_ID,
      status: "active",
      deletedAt: null,
      metadata: null,
    });
    // 3. Workspace + lookup email owner (2e user.findUnique)
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: "ws-1",
      members: [{ userId: "owner-uid", role: "owner" }],
    });
    mocks.userFindUnique.mockResolvedValueOnce({ email: "owner@example.com" });
    mocks.queryRawUnsafe.mockResolvedValueOnce([{ plan: "pro" }]);

    const { req, params } = signedGet("owner@example.com");
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      tenant_id: string;
      owner_email: string | null;
      magic_link_capable: boolean;
    };
    // La response retourne l'UUID local résolu, PAS l'email reçu.
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.owner_email).toBe("owner@example.com");
    expect(body.magic_link_capable).toBe(true);
    // workspaceFindFirst utilise l'UUID résolu, pas l'email
    expect(mocks.workspaceFindFirst.mock.calls[0][0].where.tenantId).toBe(TENANT_ID);
  });

  test("fallback plan=freemium si raw query échoue", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      status: "active",
      deletedAt: null,
      metadata: null,
    });
    mocks.workspaceFindFirst.mockResolvedValueOnce({
      id: "ws-1",
      members: [],
    });
    mocks.queryRawUnsafe.mockRejectedValueOnce(new Error("column missing"));
    const { req, params } = signedGet(TENANT_ID);
    const body = (await readJson(await GET(req, { params }))) as { plan: string };
    expect(body.plan).toBe("freemium");
  });
});
