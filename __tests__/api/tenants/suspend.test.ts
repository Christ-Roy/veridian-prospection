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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: tenantFindUnique, update: tenantUpdate },
  },
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

  test("401 si HMAC absent", async () => {
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      body: { tenant_id: "t-1" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("400 si tenant_id manquant", async () => {
    const { raw, headers } = signed({});
    const req = makeRequest("/api/tenants/suspend", {
      method: "POST",
      headers,
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
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
