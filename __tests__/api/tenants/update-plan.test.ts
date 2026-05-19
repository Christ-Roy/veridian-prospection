/**
 * Tests POST /api/tenants/update-plan — contrat §5.2.
 *
 * Couvre :
 *  - 401 si HMAC invalide
 *  - 400 si tenant_id ou plan manquant
 *  - 400 si plan invalide (pas dans la whitelist)
 *  - 400 si plan_source invalide
 *  - 404 si tenant introuvable
 *  - 409 plan_source_immutable si Stripe veut downgrade lifetime_*
 *  - 409 plan_source_immutable si Stripe veut downgrade internal
 *  - 200 + history append sur changement nominal
 *  - 200 admin manual peut override lifetime (force, audit dans history)
 *  - previous_plan correct dans la réponse
 *  - applied_at est un ISO timestamp
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-update-plan-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique, update: mocks.tenantUpdate },
  },
}));

import { POST } from "@/app/api/tenants/update-plan/route";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-update-plan-secret";

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
  return makeRequest("/api/tenants/update-plan", {
    method: "POST",
    headers,
    body: raw,
  });
}

describe("POST /api/tenants/update-plan", () => {
  beforeEach(() => vi.clearAllMocks());

  test("401 si HMAC absent", async () => {
    const r = makeRequest("/api/tenants/update-plan", {
      method: "POST",
      body: { tenant_id: "t-1", plan: "pro" },
    });
    expect((await POST(r)).status).toBe(401);
  });

  test("400 si tenant_id manquant", async () => {
    const { raw, headers } = signed({ plan: "pro" });
    expect((await POST(req(raw, headers))).status).toBe(400);
  });

  test("400 si plan manquant", async () => {
    const { raw, headers } = signed({ tenant_id: "t-1" });
    expect((await POST(req(raw, headers))).status).toBe(400);
  });

  test("400 si plan inconnu — retourne liste allowed_plans", async () => {
    const { raw, headers } = signed({ tenant_id: "t-1", plan: "ultra-mega" });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as {
      error: string;
      details: { allowed_plans: string[] };
    };
    expect(body.error).toBe("invalid_plan");
    expect(body.details.allowed_plans).toContain("freemium");
    expect(body.details.allowed_plans).toContain("lifetime_site_vitrine");
  });

  test("400 si plan_source inconnu", async () => {
    const { raw, headers } = signed({
      tenant_id: "t-1",
      plan: "pro",
      plan_source: "smoke",
    });
    expect((await POST(req(raw, headers))).status).toBe(400);
  });

  test("404 si tenant introuvable", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({ tenant_id: "t-x", plan: "pro" });
    expect((await POST(req(raw, headers))).status).toBe(404);
  });

  test("409 plan_source_immutable si Stripe veut downgrade lifetime_site_vitrine", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "lifetime_site_vitrine",
      planSource: "lifetime_site_vitrine",
    });
    const { raw, headers } = signed({
      tenant_id: "t-1",
      plan: "freemium",
      plan_source: "stripe",
    });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("plan_source_immutable");
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  test("409 plan_source_immutable si Stripe veut downgrade internal", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "internal",
      planSource: "internal",
    });
    const { raw, headers } = signed({
      tenant_id: "t-1",
      plan: "freemium",
      plan_source: "stripe",
    });
    expect((await POST(req(raw, headers))).status).toBe(409);
  });

  test("200 + history append sur changement nominal stripe pro→enterprise", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "pro",
      planSource: "stripe",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({
      tenant_id: "t-1",
      plan: "enterprise",
      plan_source: "stripe",
      reason: "stripe checkout upgrade",
    });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      tenant_id: string;
      plan: string;
      previous_plan: string;
      applied_at: string;
    };
    expect(body.plan).toBe("enterprise");
    expect(body.previous_plan).toBe("pro");
    expect(body.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(mocks.tenantUpdate).toHaveBeenCalledOnce();
    const call = mocks.tenantUpdate.mock.calls[0][0];
    expect(call.data.plan).toBe("enterprise");
    expect(call.data.planSource).toBe("stripe");
    expect(call.data.planHistory.create.previousPlan).toBe("pro");
    expect(call.data.planHistory.create.reason).toBe("stripe checkout upgrade");
  });

  test("200 admin manual peut override lifetime (force)", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: "lifetime_partner",
      planSource: "lifetime_partner",
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({
      tenant_id: "t-1",
      plan: "pro",
      plan_source: "manual",
      reason: "partnership ended",
    });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    expect(mocks.tenantUpdate).toHaveBeenCalledOnce();
  });

  test("previous_plan=null si tenant n'avait pas encore de plan", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      plan: null,
      planSource: null,
    });
    mocks.tenantUpdate.mockResolvedValueOnce({});
    const { raw, headers } = signed({
      tenant_id: "t-1",
      plan: "freemium",
      plan_source: "stripe",
    });
    const body = (await readJson(await POST(req(raw, headers)))) as {
      previous_plan: string | null;
    };
    expect(body.previous_plan).toBeNull();
  });
});
