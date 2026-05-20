/**
 * Tests POST /api/workspaces.generateMagicLink — contrat Hub §5.6.
 *
 * Couvre :
 *  - 401 invalid_bearer si Authorization absent / mal formé
 *  - 401 invalid_api_key si hash ne match aucun workspace
 *  - 400 invalid_payload si JSON invalide ou user_email manquant/mal formé
 *  - 404 user_not_member si user pas dans workspace_members du workspace lié
 *  - 200 success avec magic_link + auto_login_url + expires_at + persistance token
 *  - Idempotence du token (regenération à chaque call attendue — token one-shot)
 *  - Email normalisé lowercase + trim avant lookup
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { hashApiKey, generateApiKey } from "@/lib/hub/apiKey";

const mocks = vi.hoisted(() => ({
  workspaceFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  memberFindFirst: vi.fn(),
  tenantUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspace: { findFirst: mocks.workspaceFindFirst },
    user: { findFirst: mocks.userFindFirst },
    workspaceMember: { findFirst: mocks.memberFindFirst },
    tenant: { update: mocks.tenantUpdate },
  },
}));

import { POST } from "@/app/api/workspaces.generateMagicLink/route";
import { makeRequest, readJson } from "./_helpers";

const VALID_KEY = generateApiKey();
const VALID_HASH = hashApiKey(VALID_KEY);

function req(
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${VALID_KEY}` },
) {
  return makeRequest("/api/workspaces.generateMagicLink", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/workspaces.generateMagicLink", () => {
  beforeEach(() => vi.clearAllMocks());

  // ─── Auth ───────────────────────────────────────────────────────────────
  test("401 invalid_bearer si Authorization absent", async () => {
    const res = await POST(req({ user_email: "x@y.com" }, {}));
    expect(res.status).toBe(401);
    expect((await readJson(res)) as Record<string, unknown>).toEqual({
      error: "invalid_bearer",
    });
    expect(mocks.workspaceFindFirst).not.toHaveBeenCalled();
  });

  test("401 invalid_bearer si format Authorization invalide", async () => {
    const res = await POST(
      req({ user_email: "x@y.com" }, { authorization: "NotBearer xyz" }),
    );
    expect(res.status).toBe(401);
    expect((await readJson(res)) as Record<string, unknown>).toEqual({
      error: "invalid_bearer",
    });
  });

  test("401 invalid_api_key si hash ne match aucun workspace", async () => {
    mocks.workspaceFindFirst.mockResolvedValue(null);

    const res = await POST(req({ user_email: "x@y.com" }));
    expect(res.status).toBe(401);
    expect((await readJson(res)) as Record<string, unknown>).toEqual({
      error: "invalid_api_key",
    });
    expect(mocks.workspaceFindFirst).toHaveBeenCalledWith({
      where: { apiKeyHash: VALID_HASH, deletedAt: null },
      select: { id: true, tenantId: true, apiKeyHash: true },
    });
  });

  // ─── Payload validation ────────────────────────────────────────────────
  test("400 invalid_payload si body JSON invalide", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      apiKeyHash: VALID_HASH,
    });
    // body=string non-JSON → request.json() throw
    const res = await POST(
      req("{not json", { authorization: `Bearer ${VALID_KEY}` }),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)) as Record<string, unknown>).toEqual({
      error: "invalid_payload",
    });
  });

  test("400 invalid_payload si user_email manquant", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      apiKeyHash: VALID_HASH,
    });
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect((await readJson(res)) as Record<string, unknown>).toEqual({
      error: "invalid_payload",
    });
  });

  test("400 invalid_payload si user_email mal formé", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      apiKeyHash: VALID_HASH,
    });
    const res = await POST(req({ user_email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  test("400 invalid_payload si user_email > 254 chars (RFC 5321)", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      apiKeyHash: VALID_HASH,
    });
    const longEmail = "a".repeat(250) + "@x.fr";
    const res = await POST(req({ user_email: longEmail }));
    expect(res.status).toBe(400);
  });

  // ─── Membership ────────────────────────────────────────────────────────
  test("404 user_not_member si user inconnu en DB", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      apiKeyHash: VALID_HASH,
    });
    mocks.userFindFirst.mockResolvedValue(null);

    const res = await POST(req({ user_email: "ghost@x.com" }));
    expect(res.status).toBe(404);
    expect((await readJson(res)) as Record<string, unknown>).toEqual({
      error: "user_not_member",
    });
    expect(mocks.memberFindFirst).not.toHaveBeenCalled();
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  test("404 user_not_member si user existe mais pas dans ce workspace", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      apiKeyHash: VALID_HASH,
    });
    mocks.userFindFirst.mockResolvedValue({ id: "u1" });
    mocks.memberFindFirst.mockResolvedValue(null);

    const res = await POST(req({ user_email: "intruder@x.com" }));
    expect(res.status).toBe(404);
    expect(mocks.tenantUpdate).not.toHaveBeenCalled();
  });

  // ─── Success ───────────────────────────────────────────────────────────
  test("200 success : génère + persiste token + retourne magic_link", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      apiKeyHash: VALID_HASH,
    });
    mocks.userFindFirst.mockResolvedValue({ id: "u1" });
    mocks.memberFindFirst.mockResolvedValue({ userId: "u1" });
    mocks.tenantUpdate.mockResolvedValue({ id: "t1" });

    const res = await POST(req({ user_email: "bob@acme.fr" }));
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      magic_link: string;
      auto_login_url: string;
      expires_at: string;
    };
    expect(body.magic_link).toMatch(/\/api\/auth\/token\?t=[0-9a-f]{64}$/);
    expect(body.auto_login_url).toBe(body.magic_link);
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());

    // Persistance token côté tenant vérifié
    expect(mocks.tenantUpdate).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: expect.objectContaining({
        prospectionLoginToken: expect.stringMatching(/^[0-9a-f]{64}$/),
        prospectionLoginTokenUsedAt: null,
      }),
    });
  });

  test("email normalisé en lowercase + trim avant lookup", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      apiKeyHash: VALID_HASH,
    });
    mocks.userFindFirst.mockResolvedValue(null);

    await POST(req({ user_email: "  BOB@ACME.FR  " }));
    expect(mocks.userFindFirst).toHaveBeenCalledWith({
      where: { email: "bob@acme.fr", deletedAt: null },
      select: { id: true },
    });
  });

  test("tokens différents à chaque call (one-shot, regénération attendue)", async () => {
    mocks.workspaceFindFirst.mockResolvedValue({
      id: "w1",
      tenantId: "t1",
      apiKeyHash: VALID_HASH,
    });
    mocks.userFindFirst.mockResolvedValue({ id: "u1" });
    mocks.memberFindFirst.mockResolvedValue({ userId: "u1" });
    mocks.tenantUpdate.mockResolvedValue({ id: "t1" });

    const res1 = await POST(req({ user_email: "bob@acme.fr" }));
    const res2 = await POST(req({ user_email: "bob@acme.fr" }));
    const body1 = (await readJson(res1)) as { magic_link: string };
    const body2 = (await readJson(res2)) as { magic_link: string };
    expect(body1.magic_link).not.toBe(body2.magic_link);
  });
});
