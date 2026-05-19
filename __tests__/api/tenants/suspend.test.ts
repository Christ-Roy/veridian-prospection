/**
 * Tests POST /api/tenants/suspend — contrat §5.4.
 *
 * Couvre :
 *  - 401 si HMAC absent / invalide
 *  - 400 si tenant_id manquant
 *  - 404 si tenant introuvable
 *  - 200 + status=suspended sur tenant actif
 *  - 200 idempotent sur tenant déjà suspendu (no-op DB)
 *  - metadata.lastSuspendReason est bien stocké
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-suspend-secret";
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

import { POST } from "@/app/api/tenants/suspend/route";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-suspend-secret";

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

describe("POST /api/tenants/suspend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("401 si HMAC absent (Unauthorized générique)", async () => {
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      body: { tenant_id: "t-1" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Unauthorized");
    // Critique : pas de fuite DB avant l'auth
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  test("401 si signature HMAC invalide (Invalid signature distinct)", async () => {
    const ts = Date.now();
    const raw = JSON.stringify({ tenant_id: "t-1" });
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      headers: {
        "x-veridian-timestamp": String(ts),
        "x-veridian-hub-signature": "00".repeat(32),
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Invalid signature");
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  test("401 si timestamp drift > 5min (Timestamp expired)", async () => {
    const ts = Date.now() - 10 * 60 * 1000;
    const raw = JSON.stringify({ tenant_id: "t-1" });
    const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      headers: {
        "x-veridian-timestamp": String(ts),
        "x-veridian-hub-signature": sig,
      },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Timestamp expired or invalid");
  });

  test("400 si tenant_id manquant — error=invalid_payload (§5.10)", async () => {
    const { raw, headers } = signed({});
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      headers,
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string; message: string };
    expect(body.error).toBe("invalid_payload");
    expect(body.message).toContain("tenant_id");
    // tenant.findUnique ne doit JAMAIS être appelé sans tenant_id
    expect(tenantFindUnique).not.toHaveBeenCalled();
  });

  test("404 si tenant introuvable", async () => {
    tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({ tenant_id: "t-missing" });
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      headers,
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("tenant_not_found");
  });

  test("200 + suspend tenant actif + reason stockée", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "active",
      metadata: null,
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({
      tenant_id: "t-1",
      reason: "billing_past_due",
    });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      tenant_id: string;
      suspended_at: string;
    };
    expect(body.tenant_id).toBe("t-1");
    expect(body.suspended_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(tenantUpdate).toHaveBeenCalledOnce();
    const call = tenantUpdate.mock.calls[0][0];
    expect(call.data.status).toBe("suspended");
    expect(call.data.metadata.lastSuspendReason).toBe("billing_past_due");
  });

  test("200 idempotent sur tenant déjà suspendu (pas d'update DB)", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "suspended",
      metadata: { suspendedAt: "2026-05-19T10:00:00.000Z" },
    });
    const { raw, headers } = signed({ tenant_id: "t-1", reason: "admin_action" });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { suspended_at: string };
    expect(body.suspended_at).toBe("2026-05-19T10:00:00.000Z");
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  test("émet webhook tenant.suspended sur transition active→suspended", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "active",
      metadata: null,
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({
      tenant_id: "t-1",
      reason: "billing_past_due",
    });
    await POST(req(raw, headers));
    expect(emitWebhookMock).toHaveBeenCalledOnce();
    const [event, tenantId, data] = emitWebhookMock.mock.calls[0];
    expect(event).toBe("tenant.suspended");
    expect(tenantId).toBe("t-1");
    expect(data.reason).toBe("billing_past_due");
    expect(data.suspended_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("pas de webhook si tenant déjà suspendu (idempotent)", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "suspended",
      metadata: { suspendedAt: "2026-05-01T00:00:00Z" },
    });
    const { raw, headers } = signed({ tenant_id: "t-1" });
    await POST(req(raw, headers));
    expect(emitWebhookMock).not.toHaveBeenCalled();
  });

  test("default reason=admin_action si non fourni", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-2",
      status: "active",
      metadata: null,
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({ tenant_id: "t-2" });
    await POST(req(raw, headers));
    expect(tenantUpdate.mock.calls[0][0].data.metadata.lastSuspendReason).toBe(
      "admin_action",
    );
  });
});

function req(raw: string, headers: Record<string, string>) {
  return makeRequest("/api/tenants/suspend", {
    method: "POST",
    headers,
    body: raw,
  });
}
