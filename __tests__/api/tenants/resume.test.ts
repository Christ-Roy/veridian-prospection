/**
 * Tests POST /api/tenants/resume — contrat §5.4.
 *
 * Couvre :
 *  - 401 si HMAC invalide
 *  - 400 si tenant_id manquant
 *  - 404 si tenant introuvable
 *  - 409 transition_illegal si tenant soft_deleted (deletedAt != null)
 *  - 200 + status=active sur tenant suspendu
 *  - 200 idempotent sur tenant déjà actif (pas d'update DB)
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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: tenantFindUnique, update: tenantUpdate },
  },
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

  test("401 si HMAC absent", async () => {
    const r = makeRequest("/api/tenants/resume", {
      method: "POST",
      body: { tenant_id: "t-1" },
    });
    expect((await POST(r)).status).toBe(401);
  });

  test("400 si tenant_id manquant", async () => {
    const { raw, headers } = signed({});
    expect((await POST(req(raw, headers))).status).toBe(400);
  });

  test("404 si tenant introuvable", async () => {
    tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({ tenant_id: "t-x" });
    expect((await POST(req(raw, headers))).status).toBe(404);
  });

  test("409 transition_illegal si tenant soft_deleted", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "suspended",
      deletedAt: new Date("2026-05-01T00:00:00Z"),
      metadata: null,
    });
    const { raw, headers } = signed({ tenant_id: "t-1" });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("transition_illegal");
    expect(tenantUpdate).not.toHaveBeenCalled();
  });

  test("200 + resume tenant suspendu", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "suspended",
      deletedAt: null,
      metadata: { lastSuspendReason: "admin_action" },
    });
    tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({ tenant_id: "t-1" });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    expect(tenantUpdate).toHaveBeenCalledOnce();
    expect(tenantUpdate.mock.calls[0][0].data.status).toBe("active");
  });

  test("200 idempotent sur tenant déjà actif", async () => {
    tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      status: "active",
      deletedAt: null,
      metadata: null,
    });
    const { raw, headers } = signed({ tenant_id: "t-1" });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    expect(tenantUpdate).not.toHaveBeenCalled();
  });
});
