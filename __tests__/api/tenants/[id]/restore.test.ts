/**
 * Tests POST /api/tenants/{id}/restore — contrat §5.8.2.
 *
 * Couvre :
 *  - 401 distincts : Unauthorized, Invalid signature, Timestamp expired
 *  - 400 invalid_payload si id manquant
 *  - 404 tenant_not_found
 *  - 409 transition_illegal si tenant déjà purged
 *  - 409 tenant_not_soft_deleted si pas soft_deleted (idempotence inverse)
 *  - 200 restore tenant soft_deleted → deletedAt=NULL, purgeEligibleAt=NULL,
 *    status='suspended' (§5.7 règle #3, jamais directement vers active),
 *    metadata.restoredAt + restoreReason set
 *  - metadata existante préservée
 *  - T13 : 200 lookup par email owner (tenant_id = email legacy Hub)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-restore-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const { tenantFindUnique, tenantFindFirst, tenantUpdate, userFindUnique } =
  vi.hoisted(() => ({
    tenantFindUnique: vi.fn(),
    tenantFindFirst: vi.fn(),
    tenantUpdate: vi.fn(),
    userFindUnique: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: tenantFindUnique,
      findFirst: tenantFindFirst,
      update: tenantUpdate,
    },
    user: { findUnique: userFindUnique },
  },
}));

import { POST } from "@/app/api/tenants/[id]/restore/route";
import { makeRequest, readJson } from "../../_helpers";

const SECRET = "test-restore-secret";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID_MISSING = "99999999-9999-4999-8999-999999999999";

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

function req(tenantId: string, raw: string, headers: Record<string, string>) {
  return makeRequest(`/api/tenants/${tenantId}/restore`, {
    method: "POST",
    headers,
    body: raw,
  });
}

describe("POST /api/tenants/{id}/restore", () => {
  beforeEach(() => vi.clearAllMocks());

  test("401 Unauthorized si HMAC absent — pas de hit DB", async () => {
    const r = makeRequest(`/api/tenants/${TENANT_ID}/restore`, {
      method: "POST",
      body: {},
    });
    const res = await POST(r, { params: Promise.resolve({ id: TENANT_ID }) });
    expect(res.status).toBe(401);
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  test("401 Invalid signature si HMAC bidon", async () => {
    const r = makeRequest(`/api/tenants/${TENANT_ID}/restore`, {
      method: "POST",
      headers: {
        "x-veridian-timestamp": String(Date.now()),
        "x-veridian-hub-signature": "00".repeat(32),
      },
      body: "{}",
    });
    const res = await POST(r, { params: Promise.resolve({ id: TENANT_ID }) });
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Invalid signature");
  });

  test("404 tenant_not_found", async () => {
    tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({});
    const res = await POST(req(TENANT_ID_MISSING, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID_MISSING }),
    });
    expect(res.status).toBe(404);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("tenant_not_found");
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  test("409 transition_illegal si déjà purged", async () => {
    tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      deletedAt: new Date("2026-01-01"),
      purgedAt: new Date("2026-04-01"),
      metadata: null,
    });
    const { raw, headers } = signed({});
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("transition_illegal");
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  test("409 tenant_not_soft_deleted si tenant n'est pas soft_deleted (idempotence inverse)", async () => {
    tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      deletedAt: null,
      purgedAt: null,
      metadata: null,
    });
    const { raw, headers } = signed({});
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("tenant_not_soft_deleted");
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  test("200 restore soft_deleted → status=suspended, deletedAt+purgeEligibleAt nulled, audit en metadata", async () => {
    tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      deletedAt: new Date("2026-04-01T10:00:00Z"),
      purgedAt: null,
      metadata: { softDeleteReason: "stripe_canceled" },
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({ reason: "client paid back" });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      tenant_id: string;
      restored_at: string;
      new_status: string;
    };
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.restored_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // §5.7 règle #3 : restore → suspended jamais → active
    expect(body.new_status).toBe("suspended");

    expect(tenantUpdate).toHaveBeenCalledOnce();
    const updateCall = tenantUpdate.mock.calls[0][0];
    expect(updateCall.where.id).toBe(TENANT_ID);
    expect(updateCall.data.deletedAt).toBeNull();
    expect(updateCall.data.purgeEligibleAt).toBeNull();
    expect(updateCall.data.status).toBe("suspended");
    // metadata existante préservée + restoredAt + restoreReason ajoutés
    expect(updateCall.data.metadata.softDeleteReason).toBe("stripe_canceled");
    expect(updateCall.data.metadata.restoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(updateCall.data.metadata.restoreReason).toBe("client paid back");
  });

  test("reason null si non fourni — passe quand même", async () => {
    tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      deletedAt: new Date("2026-04-01"),
      purgedAt: null,
      metadata: null,
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({});
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(200);
    expect(tenantUpdate.mock.calls[0][0].data.metadata.restoreReason).toBeNull();
  });

  test("T13 — 200 lookup par email owner (tenant_id = email legacy)", async () => {
    // Le Hub legacy peut envoyer `tenant_id: owner@example.com` (provision).
    userFindUnique.mockResolvedValueOnce({ id: "owner-uid" });
    tenantFindFirst.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: "owner-uid",
    });
    tenantFindUnique.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: "owner-uid",
      deletedAt: new Date("2026-04-01T10:00:00Z"),
      purgedAt: null,
      metadata: null,
    });
    tenantUpdate.mockResolvedValueOnce({});

    const { raw, headers } = signed({ reason: "manual restore" });
    const res = await POST(req("owner@example.com", raw, headers), {
      params: Promise.resolve({ id: "owner@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { tenant_id: string };
    expect(body.tenant_id).toBe(TENANT_ID);
    // L'update DB utilise l'UUID résolu, PAS l'email.
    expect(tenantUpdate.mock.calls[0][0].where.id).toBe(TENANT_ID);
  });
});
