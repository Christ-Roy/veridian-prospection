/**
 * Tests POST /api/tenants/resume — contrat §5.4.
 *
 * Couvre :
 *  - 401 distinct selon le cas : Unauthorized (rien) / Invalid signature / Timestamp expired
 *  - 400 invalid_payload si tenant_id manquant
 *  - 404 tenant_not_found
 *  - 409 transition_illegal si tenant soft_deleted (deletedAt != null)
 *  - 200 + status=active sur tenant suspendu + webhook tenant.resumed émis
 *  - 200 idempotent sur tenant déjà actif (pas d'update DB, pas de webhook)
 *  - tenant.update est appelé avec le bon where (tenant_id correct)
 *  - metadata.resumedAt est bien stocké et préserve la metadata existante
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-resume-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const { tenantFindUnique, tenantUpdate } = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantUpdate: vi.fn(),
}));

const { emitWebhookMock } = vi.hoisted(() => ({
  emitWebhookMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: tenantFindUnique, update: tenantUpdate },
  },
}));

vi.mock("@/lib/hub/webhooks", () => ({
  emitHubWebhookAsync: emitWebhookMock,
}));

import { POST } from "@/app/api/tenants/resume/route";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-resume-secret";

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
  return makeRequest("/api/tenants/resume", {
    method: "POST",
    headers,
    body: raw,
  });
}

describe("POST /api/tenants/resume", () => {
  beforeEach(() => vi.clearAllMocks());

  // ───────── Auth ─────────

  test("401 Unauthorized si aucun header HMAC", async () => {
    const r = makeRequest("/api/tenants/resume", {
      method: "POST",
      body: { tenant_id: "t-1" },
    });
    const res = await POST(r);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Unauthorized");
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  test("401 Invalid signature si HMAC bidon", async () => {
    const raw = JSON.stringify({ tenant_id: "t-1" });
    const r = makeRequest("/api/tenants/resume", {
      method: "POST",
      headers: {
        "x-veridian-timestamp": String(Date.now()),
        "x-veridian-hub-signature": "00".repeat(32),
      },
      body: raw,
    });
    const res = await POST(r);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Invalid signature");
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  test("401 Timestamp expired si drift > 5min", async () => {
    const ts = Date.now() - 10 * 60 * 1000;
    const raw = JSON.stringify({ tenant_id: "t-1" });
    const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
    const r = makeRequest("/api/tenants/resume", {
      method: "POST",
      headers: {
        "x-veridian-timestamp": String(ts),
        "x-veridian-hub-signature": sig,
      },
      body: raw,
    });
    const res = await POST(r);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Timestamp expired or invalid");
  });

  // ───────── Validation payload ─────────

  test("400 invalid_payload si tenant_id manquant — pas de hit DB", async () => {
    const { raw, headers } = signed({});
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string; message: string };
    expect(body.error).toBe("invalid_payload");
    expect(body.message).toContain("tenant_id");
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  // ───────── Lookup ─────────

  test("404 tenant_not_found", async () => {
    tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({ tenant_id: "t-x" });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(404);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("tenant_not_found");
    // findUnique a bien été appelé avec le tenant_id demandé
    expect(tenantFindUnique).toHaveBeenCalledOnce();
    expect(tenantFindUnique.mock.calls[0][0].where.id).toBe("t-x");
    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(emitWebhookMock).not.toHaveBeenCalled();
  });

  // ───────── Transition illégale ─────────

  test("409 transition_illegal si tenant soft_deleted (deletedAt != null)", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "suspended",
      deletedAt: new Date("2026-05-01T00:00:00Z"),
      metadata: null,
    });
    const { raw, headers } = signed({ tenant_id: "t-1" });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as { error: string; message: string };
    expect(body.error).toBe("transition_illegal");
    expect(body.message).toContain("soft_deleted");
    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(emitWebhookMock).not.toHaveBeenCalled();
  });

  // ───────── Happy path ─────────

  test("200 + status=active sur tenant suspendu + body bien formé", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "suspended",
      deletedAt: null,
      metadata: { lastSuspendReason: "billing_past_due" },
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({ tenant_id: "t-1" });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      tenant_id: string;
      resumed_at: string;
    };
    expect(body.tenant_id).toBe("t-1");
    expect(body.resumed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(tenantUpdate).toHaveBeenCalledOnce();
    const updateCall = tenantUpdate.mock.calls[0][0];
    expect(updateCall.where.id).toBe("t-1");
    expect(updateCall.data.status).toBe("active");
    // metadata existante préservée + resumedAt ajouté
    expect(updateCall.data.metadata.lastSuspendReason).toBe("billing_past_due");
    expect(updateCall.data.metadata.resumedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("émet webhook tenant.resumed avec resumed_at dans data", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "suspended",
      deletedAt: null,
      metadata: null,
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({ tenant_id: "t-1" });
    await POST(req(raw, headers));

    expect(emitWebhookMock).toHaveBeenCalledOnce();
    const [event, tenantId, data] = emitWebhookMock.mock.calls[0];
    expect(event).toBe("tenant.resumed");
    expect(tenantId).toBe("t-1");
    expect(data.resumed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ───────── Idempotence ─────────

  test("200 idempotent sur tenant déjà actif — pas d'update, pas de webhook", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "active",
      deletedAt: null,
      metadata: null,
    });
    const { raw, headers } = signed({ tenant_id: "t-1" });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { tenant_id: string };
    expect(body.tenant_id).toBe("t-1");
    expect(tenantUpdate).not.toHaveBeenCalled();
    expect(emitWebhookMock).not.toHaveBeenCalled();
  });

  test("metadata null ne crash pas — utilise {} par défaut", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "suspended",
      deletedAt: null,
      metadata: null,
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({ tenant_id: "t-1" });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    expect(tenantUpdate.mock.calls[0][0].data.metadata.resumedAt).toBeTruthy();
  });
});
