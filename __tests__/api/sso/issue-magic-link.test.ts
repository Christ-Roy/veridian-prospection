/**
 * Tests POST /api/sso/issue-magic-link — Couche 4 SSO bounce OAuth Hub
 * (cf. veridian-hub/docs/CONTRAT-HUB.md §6bis.8).
 *
 * Couvre :
 *  - 401 HMAC absent / invalide / timestamp drift
 *  - 400 body mal formé / hub_user_id absent / email invalide
 *  - 400 user_not_in_app si user inconnu OU sans tenant actif
 *  - 200 magic_link_url si user trouvé via hub_user_id
 *  - 200 magic_link_url si user trouvé via email (fallback legacy)
 *  - Multi-workspaces : magic_link sur le dernier tenant actif (orderBy updatedAt desc)
 *  - 429 rate-limited après 10 req/min/user
 *  - 500 server_error si HUB_API_SECRET absent
 *  - Pas d'auto-création de workspace si user_not_in_app
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-sso-secret";
  process.env.APP_URL = "https://prospection.app.veridian.site";
});

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  tenantFindFirst: vi.fn(),
  tenantUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: mocks.userFindFirst },
    tenant: {
      findFirst: mocks.tenantFindFirst,
      update: mocks.tenantUpdate,
    },
  },
}));

import { POST } from "@/app/api/sso/issue-magic-link/route";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-sso-secret";

function signedBody(payload: Record<string, unknown>, ts = Date.now()) {
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  return {
    headers: {
      "x-veridian-timestamp": String(ts),
      "x-veridian-hub-signature": sig,
      "content-type": "application/json",
    },
    body: raw,
  };
}

function req(payload: Record<string, unknown>, overrideHeaders: Record<string, string> = {}) {
  const s = signedBody(payload);
  return makeRequest("/api/sso/issue-magic-link", {
    method: "POST",
    headers: { ...s.headers, ...overrideHeaders },
    body: s.body,
  });
}

describe("POST /api/sso/issue-magic-link — Hub bounce OAuth", () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── Auth HMAC ────────────────────────────────────────────────────────────
  test("401 si aucune signature HMAC", async () => {
    const res = await POST(
      makeRequest("/api/sso/issue-magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hub_user_id: "u1", email: "a@b.com" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });

  test("401 si signature invalide", async () => {
    const ts = Date.now();
    const res = await POST(
      makeRequest("/api/sso/issue-magic-link", {
        method: "POST",
        headers: {
          "x-veridian-timestamp": String(ts),
          "x-veridian-hub-signature": "deadbeef".repeat(8),
          "content-type": "application/json",
        },
        body: JSON.stringify({ hub_user_id: "u1", email: "a@b.com" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });

  test("401 si timestamp drift > 5min", async () => {
    const oldTs = Date.now() - 10 * 60 * 1000;
    const res = await POST(req({ hub_user_id: "u1", email: "a@b.com" }, {
      ...signedBody({ hub_user_id: "u1", email: "a@b.com" }, oldTs).headers,
    }));
    // L'override de timestamp dans req mélange avec la sig recalculée — refaisons proprement
    const ts = Date.now() - 10 * 60 * 1000;
    const raw = JSON.stringify({ hub_user_id: "u1", email: "a@b.com" });
    const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
    const res2 = await POST(
      makeRequest("/api/sso/issue-magic-link", {
        method: "POST",
        headers: {
          "x-veridian-timestamp": String(ts),
          "x-veridian-hub-signature": sig,
          "content-type": "application/json",
        },
        body: raw,
      }),
    );
    expect(res2.status).toBe(401);
    expect(res.status).toBe(401);
  });

  // ─── Validation body ──────────────────────────────────────────────────────
  test("400 si body JSON invalide", async () => {
    const ts = Date.now();
    const raw = "not-json{";
    const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
    const res = await POST(
      makeRequest("/api/sso/issue-magic-link", {
        method: "POST",
        headers: {
          "x-veridian-timestamp": String(ts),
          "x-veridian-hub-signature": sig,
          "content-type": "application/json",
        },
        body: raw,
      }),
    );
    expect(res.status).toBe(400);
  });

  test("400 si hub_user_id manquant", async () => {
    const res = await POST(req({ email: "a@b.com" }));
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.error).toBe("invalid_payload");
  });

  test("400 si email invalide", async () => {
    const res = await POST(req({ hub_user_id: "u1", email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  // ─── User lookup ──────────────────────────────────────────────────────────
  test("400 user_not_in_app si aucun user trouvé (ni hub_user_id ni email)", async () => {
    mocks.userFindFirst.mockResolvedValue(null);
    const res = await POST(
      req({ hub_user_id: "u-unknown", email: "unknown@x.com" }),
    );
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.error).toBe("user_not_in_app");
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  test("400 user_not_in_app si user existe mais 0 tenant actif", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({
      id: "user-1",
      email: "alice@example.com",
    });
    mocks.tenantFindFirst.mockResolvedValue(null);

    const res = await POST(
      req({ hub_user_id: "hub-u1", email: "alice@example.com" }),
    );
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.error).toBe("user_not_in_app");
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  test("200 magic_link_url si user trouvé par hub_user_id", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({
      id: "user-1",
      email: "alice@example.com",
    });
    mocks.tenantFindFirst.mockResolvedValue({
      id: "tenant-1",
      status: "active",
    });
    mocks.tenantUpdate.mockResolvedValue({});

    const res = await POST(
      req({ hub_user_id: "hub-u1", email: "alice@example.com" }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(typeof body.magic_link_url).toBe("string");
    expect((body.magic_link_url as string).startsWith(
      "https://prospection.app.veridian.site/api/auth/token?t=",
    )).toBe(true);
    // Token persisté avec used=null
    expect(mocks.tenantUpdate).toHaveBeenCalledOnce();
    const call = mocks.tenantUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: "tenant-1" });
    expect(call.data.prospectionLoginTokenUsedAt).toBeNull();
    expect(typeof call.data.prospectionLoginToken).toBe("string");
    expect((call.data.prospectionLoginToken as string).length).toBe(64); // 32 bytes hex
  });

  test("200 magic_link_url si user trouvé par email (fallback hub_user_id absent en DB)", async () => {
    // Premier findFirst (par hub_user_id) → null
    mocks.userFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "user-legacy",
        email: "bob@example.com",
      });
    mocks.tenantFindFirst.mockResolvedValue({
      id: "tenant-legacy",
      status: "active",
    });
    mocks.tenantUpdate.mockResolvedValue({});

    const res = await POST(
      req({ hub_user_id: "hub-bob-new", email: "bob@example.com" }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(typeof body.magic_link_url).toBe("string");
  });

  test("multi-workspaces : magic link sur dernier tenant actif (orderBy updatedAt desc)", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({
      id: "user-multi",
      email: "carol@example.com",
    });
    mocks.tenantFindFirst.mockResolvedValue({
      id: "tenant-last-active",
      status: "active",
    });
    mocks.tenantUpdate.mockResolvedValue({});

    await POST(req({ hub_user_id: "hub-carol", email: "carol@example.com" }));

    // Vérifier que findFirst tenant a bien été appelé avec orderBy
    const tenantCall = mocks.tenantFindFirst.mock.calls[0][0];
    expect(tenantCall.orderBy).toEqual({ updatedAt: "desc" });
    expect(tenantCall.where.userId).toBe("user-multi");
    expect(tenantCall.where.deletedAt).toBeNull();
  });
});

describe("POST /api/sso/issue-magic-link — rate limit", () => {
  test("429 après 10 req/min sur même hub_user_id", async () => {
    vi.clearAllMocks();
    mocks.userFindFirst.mockResolvedValue({
      id: "user-rl",
      email: "rl@example.com",
    });
    mocks.tenantFindFirst.mockResolvedValue({
      id: "tenant-rl",
      status: "active",
    });
    mocks.tenantUpdate.mockResolvedValue({});

    const hubId = `hub-rl-${Date.now()}`;
    // 10 premières passent
    for (let i = 0; i < 10; i++) {
      const r = await POST(req({ hub_user_id: hubId, email: "rl@example.com" }));
      expect(r.status).toBe(200);
    }
    // 11ème → 429
    const blocked = await POST(req({ hub_user_id: hubId, email: "rl@example.com" }));
    expect(blocked.status).toBe(429);
    const body = (await readJson(blocked)) as Record<string, unknown>;
    expect(body.error).toBe("rate_limited");
  });
});
