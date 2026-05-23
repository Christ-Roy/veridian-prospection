/**
 * Tests POST /api/tenants/{id}/soft-delete — contrat §5.8.1.
 *
 * Couvre :
 *  - 401 distincts : Unauthorized (rien), Invalid signature (HMAC bidon),
 *    Timestamp expired (drift > 5min)
 *  - 400 invalid_payload : id manquant, purge_eligible_at absent, malformé
 *  - 404 tenant_not_found
 *  - 409 transition_illegal si déjà purged
 *  - 200 + soft-delete tenant actif → deletedAt + purgeEligibleAt set,
 *    softDeleteReason en metadata, webhook tenant.soft_deleted (§7.1 v1.4) émis
 *  - 200 + soft-delete tenant suspendu → previous_status="suspended"
 *  - 200 idempotent sur tenant déjà soft_deleted : pas d'update DB,
 *    pas de webhook, retour des valeurs existantes
 *  - T13 : 200 lookup par email owner (tenant_id = email legacy Hub)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-softdelete-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const { tenantFindUnique, tenantFindFirst, tenantUpdate, userFindUnique } =
  vi.hoisted(() => ({
    tenantFindUnique: vi.fn(),
    tenantFindFirst: vi.fn(),
    tenantUpdate: vi.fn(),
    userFindUnique: vi.fn(),
  }));

const { emitWebhookMock } = vi.hoisted(() => ({
  emitWebhookMock: vi.fn(),
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

vi.mock("@/lib/hub/webhooks", () => ({
  emitHubWebhookAsync: emitWebhookMock,
}));

import { POST } from "@/app/api/tenants/[id]/soft-delete/route";
import { makeRequest, readJson } from "../../_helpers";

const SECRET = "test-softdelete-secret";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID_2 = "22222222-2222-4222-8222-222222222222";
const TENANT_ID_3 = "33333333-3333-4333-8333-333333333333";
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
  return makeRequest(`/api/tenants/${tenantId}/soft-delete`, {
    method: "POST",
    headers,
    body: raw,
  });
}

const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

describe("POST /api/tenants/{id}/soft-delete", () => {
  beforeEach(() => vi.clearAllMocks());

  // ───────── Auth ─────────

  test("401 Unauthorized si HMAC absent — pas de hit DB", async () => {
    const r = makeRequest(`/api/tenants/${TENANT_ID}/soft-delete`, {
      method: "POST",
      body: { purge_eligible_at: futureDate },
    });
    const res = await POST(r, { params: Promise.resolve({ id: TENANT_ID }) });
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Unauthorized");
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  test("401 Invalid signature si HMAC bidon", async () => {
    const raw = JSON.stringify({ purge_eligible_at: futureDate });
    const r = makeRequest(`/api/tenants/${TENANT_ID}/soft-delete`, {
      method: "POST",
      headers: {
        "x-veridian-timestamp": String(Date.now()),
        "x-veridian-hub-signature": "00".repeat(32),
      },
      body: raw,
    });
    const res = await POST(r, { params: Promise.resolve({ id: TENANT_ID }) });
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Invalid signature");
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  test("401 Timestamp expired si drift > 5min", async () => {
    const ts = Date.now() - 10 * 60 * 1000;
    const raw = JSON.stringify({ purge_eligible_at: futureDate });
    const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
    const r = makeRequest(`/api/tenants/${TENANT_ID}/soft-delete`, {
      method: "POST",
      headers: {
        "x-veridian-timestamp": String(ts),
        "x-veridian-hub-signature": sig,
      },
      body: raw,
    });
    const res = await POST(r, { params: Promise.resolve({ id: TENANT_ID }) });
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Timestamp expired or invalid");
  });

  // ───────── Validation payload ─────────

  test("400 invalid_payload si purge_eligible_at absent — pas de hit DB", async () => {
    const { raw, headers } = signed({});
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string; message: string };
    expect(body.error).toBe("invalid_payload");
    expect(body.message).toContain("purge_eligible_at");
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  test("400 invalid_payload si purge_eligible_at malformé", async () => {
    const { raw, headers } = signed({ purge_eligible_at: "not-a-date" });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("invalid_payload");
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  // ───────── Lookup ─────────

  test("404 tenant_not_found — helper appelé avec le bon UUID", async () => {
    tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({ purge_eligible_at: futureDate });
    const res = await POST(req(TENANT_ID_MISSING, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID_MISSING }),
    });
    expect(res.status).toBe(404);
    expect(tenantFindUnique).toHaveBeenCalledOnce();
    expect(tenantFindUnique.mock.calls[0][0].where.id).toBe(TENANT_ID_MISSING);
    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(emitWebhookMock).not.toHaveBeenCalled();
  });

  // ───────── Transitions illégales ─────────

  test("409 transition_illegal si tenant déjà purged", async () => {
    tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      status: "deleted",
      deletedAt: new Date("2026-01-01"),
      purgeEligibleAt: new Date("2026-04-01"),
      purgedAt: new Date("2026-04-15"),
      metadata: null,
    });
    const { raw, headers } = signed({ purge_eligible_at: futureDate });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("transition_illegal");
    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(emitWebhookMock).not.toHaveBeenCalled();
  });

  // ───────── Happy paths ─────────

  test("200 soft-delete tenant actif → deletedAt + purgeEligibleAt + reason + webhook", async () => {
    tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      status: "active",
      deletedAt: null,
      purgeEligibleAt: null,
      purgedAt: null,
      metadata: null,
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({
      purge_eligible_at: futureDate,
      reason: "stripe_canceled",
    });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      tenant_id: string;
      soft_deleted_at: string;
      purge_eligible_at: string;
      previous_status: string;
    };
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.soft_deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.purge_eligible_at).toBe(futureDate);
    expect(body.previous_status).toBe("active");

    expect(tenantUpdate).toHaveBeenCalledOnce();
    const updateCall = tenantUpdate.mock.calls[0][0];
    expect(updateCall.where.id).toBe(TENANT_ID);
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date);
    expect(updateCall.data.purgeEligibleAt).toBeInstanceOf(Date);
    expect(updateCall.data.metadata.softDeleteReason).toBe("stripe_canceled");

    expect(emitWebhookMock).toHaveBeenCalledOnce();
    const [event, id, data] = emitWebhookMock.mock.calls[0];
    // §7.1 v1.4 — event spécifique soft-delete (≠ tenant.deleted générique).
    // Le Hub matérialise prospection_soft_deleted_at sur ce signal.
    expect(event).toBe("tenant.soft_deleted");
    expect(id).toBe(TENANT_ID);
    expect(data.reason).toBe("stripe_canceled");
    expect(data.purge_eligible_at).toBe(futureDate);
    expect(data.soft_deleted_at).toBeDefined();
  });

  test("200 soft-delete tenant suspended → previous_status='suspended'", async () => {
    tenantFindUnique.mockResolvedValue({
      id: TENANT_ID_2,
      userId: "owner-uid-2",
      status: "suspended",
      deletedAt: null,
      purgeEligibleAt: null,
      purgedAt: null,
      metadata: { lastSuspendReason: "billing_past_due" },
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({ purge_eligible_at: futureDate });
    const body = (await readJson(
      await POST(req(TENANT_ID_2, raw, headers), {
        params: Promise.resolve({ id: TENANT_ID_2 }),
      }),
    )) as { previous_status: string };
    expect(body.previous_status).toBe("suspended");
    // metadata précédente préservée
    expect(tenantUpdate.mock.calls[0][0].data.metadata.lastSuspendReason).toBe(
      "billing_past_due",
    );
  });

  test("default reason = admin_action si non fourni", async () => {
    tenantFindUnique.mockResolvedValue({
      id: TENANT_ID_3,
      userId: "owner-uid-3",
      status: "active",
      deletedAt: null,
      purgeEligibleAt: null,
      purgedAt: null,
      metadata: null,
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({ purge_eligible_at: futureDate });
    await POST(req(TENANT_ID_3, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID_3 }),
    });
    expect(tenantUpdate.mock.calls[0][0].data.metadata.softDeleteReason).toBe(
      "admin_action",
    );
    expect(emitWebhookMock.mock.calls[0][2].reason).toBe("admin_action");
  });

  // ───────── Idempotence ─────────

  test("200 idempotent sur tenant déjà soft_deleted — pas d'update, pas de webhook", async () => {
    const existingDeletedAt = new Date("2026-05-01T10:00:00Z");
    const existingPurgeAt = new Date("2026-08-01T10:00:00Z");
    tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      status: "active",
      deletedAt: existingDeletedAt,
      purgeEligibleAt: existingPurgeAt,
      purgedAt: null,
      metadata: null,
    });
    const { raw, headers } = signed({ purge_eligible_at: futureDate });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      soft_deleted_at: string;
      purge_eligible_at: string;
    };
    // Retourne les valeurs existantes, pas celles du body
    expect(body.soft_deleted_at).toBe(existingDeletedAt.toISOString());
    expect(body.purge_eligible_at).toBe(existingPurgeAt.toISOString());
    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(emitWebhookMock).not.toHaveBeenCalled();
  });

  // ───────── T13 : lookup par email owner ─────────

  test("T13 — 200 lookup par email owner (tenant_id = email legacy)", async () => {
    // Le Hub legacy peut envoyer `tenant_id: owner@example.com` (provision).
    // resolveTenantByIdOrEmail bascule sur user → tenant.findFirst.
    userFindUnique.mockResolvedValueOnce({ id: "owner-uid" });
    tenantFindFirst.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: "owner-uid",
    });
    // Puis la route récupère le tenant via findUnique(UUID résolu).
    tenantFindUnique.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: "owner-uid",
      status: "active",
      deletedAt: null,
      purgeEligibleAt: null,
      purgedAt: null,
      metadata: null,
    });
    tenantUpdate.mockResolvedValueOnce({});

    const { raw, headers } = signed({ purge_eligible_at: futureDate });
    const res = await POST(req("owner@example.com", raw, headers), {
      params: Promise.resolve({ id: "owner@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { tenant_id: string };
    // Response = UUID résolu, PAS l'email reçu.
    expect(body.tenant_id).toBe(TENANT_ID);
    // L'update DB utilise l'UUID résolu.
    expect(tenantUpdate.mock.calls[0][0].where.id).toBe(TENANT_ID);
  });
});
