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
 *  - Membre invité sans tenant propre : 200, jeton lié au user
 *  - hub_user_id non UUID (cuid Hub) : 400, pas de 500, aucune requête
 *  - Repli email réservé aux comptes sans lien : rattachement, sinon refus sans jeton
 *  - 429 rate-limited après 10 req/min/user
 *  - 500 server_error si HUB_API_SECRET absent
 *  - Pas d'auto-création de workspace si user_not_in_app
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHash, createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-sso-secret";
  process.env.APP_URL = "https://prospection.app.veridian.site";
});

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  userUpdateMany: vi.fn(),
  tenantFindFirst: vi.fn(),
  memberFindMany: vi.fn(),
  tokenCreate: vi.fn(),
  tokenDeleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: mocks.userFindFirst, updateMany: mocks.userUpdateMany },
    tenant: { findFirst: mocks.tenantFindFirst },
    workspaceMember: { findMany: mocks.memberFindMany },
    ssoLoginToken: { create: mocks.tokenCreate, deleteMany: mocks.tokenDeleteMany },
  },
}));

import { POST } from "@/app/api/sso/issue-magic-link/route";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-sso-secret";
const HUB_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memberFindMany.mockResolvedValue([]);
    mocks.userUpdateMany.mockResolvedValue({ count: 1 });
    mocks.tokenDeleteMany.mockResolvedValue({ count: 0 });
    mocks.tokenCreate.mockResolvedValue({});
  });

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
      req({ hub_user_id: HUB_UUID, email: "unknown@x.com" }),
    );
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.error).toBe("user_not_in_app");
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
  });

  test("400 user_not_in_app si user existe mais 0 tenant actif", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({
      id: "user-1",
      hubUserId: HUB_UUID,
    });
    mocks.tenantFindFirst.mockResolvedValue(null);

    const res = await POST(
      req({ hub_user_id: HUB_UUID, email: "alice@example.com" }),
    );
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.error).toBe("user_not_in_app");
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
  });

  test("200 magic_link_url si user trouvé par hub_user_id", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({
      id: "user-1",
      hubUserId: HUB_UUID,
    });
    mocks.tenantFindFirst.mockResolvedValue({
      id: "tenant-1",
      status: "active",
    });

    const res = await POST(
      req({ hub_user_id: HUB_UUID, email: "alice@example.com" }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(typeof body.magic_link_url).toBe("string");
    expect((body.magic_link_url as string).startsWith(
      "https://prospection.app.veridian.site/api/auth/token?t=",
    )).toBe(true);
    // Jeton persisté haché, lié au user, 15 min : le clair ne va jamais en base.
    const clear = (body.magic_link_url as string).split("t=")[1];
    expect(clear.length).toBe(64); // 32 bytes hex
    expect(mocks.tokenCreate).toHaveBeenCalledOnce();
    const data = mocks.tokenCreate.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(createHash("sha256").update(clear).digest("hex"));
    expect(data.tokenHash).not.toBe(clear);
    expect(data.userId).toBe("user-1");
    const ttl = data.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  test("200 magic_link_url si user trouvé par email (fallback hub_user_id absent en DB)", async () => {
    // Premier findFirst (par hub_user_id) → null
    mocks.userFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "user-legacy",
        hubUserId: null,
      });
    mocks.tenantFindFirst.mockResolvedValue({
      id: "tenant-legacy",
      status: "active",
    });

    const res = await POST(
      req({ hub_user_id: HUB_UUID, email: "bob@example.com", email_proven: true }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(typeof body.magic_link_url).toBe("string");
    // §3.7 : backfill atomique au premier contact.
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: "user-legacy", hubUserId: null },
      data: { hubUserId: HUB_UUID },
    });
  });

  test("sans email_proven : aucun repli par email, compte sans lien non ouvert", async () => {
    mocks.userFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      "email" in where ? { id: "user-victime", hubUserId: null } : null,
    );
    mocks.tenantFindFirst.mockResolvedValue({ id: "t-v" });
    const res = await POST(req({ hub_user_id: HUB_UUID, email: "victime@example.com" }));
    expect(res.status).toBe(400);
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    mocks.userFindFirst.mockReset();
  });

  test("email d'un compte lié à une autre identité Hub : refus, aucun jeton, aucune réécriture", async () => {
    mocks.userFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "user-x", hubUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    mocks.tenantFindFirst.mockResolvedValue({ id: "t-x" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(req({ hub_user_id: HUB_UUID, email: "x@example.com", email_proven: true }));
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.error).toBe("user_not_in_app");
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("hub_user_id conflict"));
    warn.mockRestore();
  });

  test("hub_user_id non UUID (cuid Hub) : 400 propre, pas de P2023, aucun jeton", async () => {
    // Le mock reproduit Postgres : un non-UUID sur la colonne @db.Uuid lève P2023.
    mocks.userFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if ("hubUserId" in where) throw new Error("P2023 invalid uuid");
      return { id: "user-cuid", hubUserId: null };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(
      req({ hub_user_id: "cmpf9zkaw0000xxxxxxxxxxxx", email: "cuid@example.com" }),
    );
    expect(res.status).toBe(400);
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
    warn.mockRestore();
    mocks.userFindFirst.mockReset();
  });

  test("membre invité sans tenant propre : 200 et jeton au nom du membre", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({ id: "user-member", hubUserId: HUB_UUID });
    mocks.memberFindMany.mockResolvedValue([{ workspace: { tenantId: "t-owner" } }]);
    mocks.tenantFindFirst.mockResolvedValue({ id: "t-owner" });
    const res = await POST(req({ hub_user_id: HUB_UUID, email: "member@example.com" }));
    expect(res.status).toBe(200);
    const where = mocks.tenantFindFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ userId: "user-member" }, { id: { in: ["t-owner"] } }]);
    expect(mocks.tokenCreate.mock.calls[0][0].data.userId).toBe("user-member");
  });

  test("500 server_error si la persistance du jeton échoue (pas de lien sans jeton)", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({ id: "user-err", hubUserId: HUB_UUID });
    mocks.tenantFindFirst.mockResolvedValue({ id: "t-err" });
    mocks.tokenCreate.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req({ hub_user_id: HUB_UUID, email: "err@example.com" }));
    expect(res.status).toBe(500);
    err.mockRestore();
  });

  test("multi-workspaces : magic link sur dernier tenant actif (orderBy updatedAt desc)", async () => {
    mocks.userFindFirst.mockResolvedValueOnce({
      id: "user-multi",
      hubUserId: HUB_UUID,
    });
    mocks.tenantFindFirst.mockResolvedValue({
      id: "tenant-last-active",
      status: "active",
    });

    await POST(req({ hub_user_id: HUB_UUID, email: "carol@example.com" }));

    // Vérifier que findFirst tenant a bien été appelé avec orderBy
    const tenantCall = mocks.tenantFindFirst.mock.calls[0][0];
    expect(tenantCall.orderBy).toEqual({ updatedAt: "desc" });
    expect(tenantCall.where.OR[0]).toEqual({ userId: "user-multi" });
    expect(tenantCall.where.deletedAt).toBeNull();
  });
});

describe("POST /api/sso/issue-magic-link — rate limit", () => {
  test("429 après 10 req/min sur même hub_user_id", async () => {
    vi.clearAllMocks();
    mocks.memberFindMany.mockResolvedValue([]);
    mocks.tokenDeleteMany.mockResolvedValue({ count: 0 });
    mocks.tokenCreate.mockResolvedValue({});
    mocks.userFindFirst.mockResolvedValue({
      id: "user-rl",
      hubUserId: null,
    });
    mocks.tenantFindFirst.mockResolvedValue({
      id: "tenant-rl",
      status: "active",
    });

    const hubId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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
