/**
 * Tests POST /api/tenants/attach-owner — contrat §5.3.
 *
 * Couvre :
 *  - 401 si HMAC invalide
 *  - 400 si tenant_id ou owner_email manquant
 *  - 400 si role invalide
 *  - 404 si tenant introuvable
 *  - 200 + attached=true sur owner créé (user nouveau)
 *  - 200 + attached=true sur owner créé (user existant)
 *  - 200 + already_attached=true si user déjà membre avec role >= demandé
 *  - 200 + upgrade si user existait avec role inférieur
 *  - workspace "default" créé si absent
 *  - additif : ne retire jamais l'owner existant
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-attach-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userCreate: vi.fn(),
  workspaceFindFirst: vi.fn(),
  workspaceCreate: vi.fn(),
  memberFindUnique: vi.fn(),
  memberCreate: vi.fn(),
  memberUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
    user: { findFirst: mocks.userFindFirst, create: mocks.userCreate },
    workspace: {
      findFirst: mocks.workspaceFindFirst,
      create: mocks.workspaceCreate,
    },
    workspaceMember: {
      findUnique: mocks.memberFindUnique,
      create: mocks.memberCreate,
      update: mocks.memberUpdate,
    },
  },
}));

import { POST } from "@/app/api/tenants/attach-owner/route";
import { makeRequest, readJson } from "../_helpers";

const SECRET = "test-attach-secret";

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
  return makeRequest("/api/tenants/attach-owner", {
    method: "POST",
    headers,
    body: raw,
  });
}

describe("POST /api/tenants/attach-owner", () => {
  beforeEach(() => vi.clearAllMocks());

  test("401 si HMAC absent", async () => {
    const r = makeRequest("/api/tenants/attach-owner", {
      method: "POST",
      body: { tenant_id: "t-1", owner_email: "a@b.c" },
    });
    expect((await POST(r)).status).toBe(401);
  });

  test("400 si tenant_id manquant", async () => {
    const { raw, headers } = signed({ owner_email: "a@b.c" });
    expect((await POST(req(raw, headers))).status).toBe(400);
  });

  test("400 si owner_email manquant", async () => {
    const { raw, headers } = signed({ tenant_id: "t-1" });
    expect((await POST(req(raw, headers))).status).toBe(400);
  });

  test("400 si role invalide (member ou viewer rejetés)", async () => {
    const { raw, headers } = signed({
      tenant_id: "t-1",
      owner_email: "a@b.c",
      role: "member",
    });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(400);
  });

  test("404 si tenant introuvable", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({ tenant_id: "t-x", owner_email: "a@b.c" });
    expect((await POST(req(raw, headers))).status).toBe(404);
  });

  test("200 attached=true sur user nouveau + workspace default créé", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: "t-1" });
    mocks.userFindFirst.mockResolvedValueOnce(null);
    mocks.userCreate.mockResolvedValueOnce({});
    mocks.workspaceFindFirst.mockResolvedValueOnce(null);
    mocks.workspaceCreate.mockResolvedValueOnce({ id: "ws-1" });
    mocks.memberFindUnique.mockResolvedValueOnce(null);
    mocks.memberCreate.mockResolvedValueOnce({});

    const { raw, headers } = signed({
      tenant_id: "t-1",
      owner_email: "owner@example.com",
    });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      attached: boolean;
      already_attached: boolean;
      role: string;
    };
    expect(body.attached).toBe(true);
    expect(body.already_attached).toBe(false);
    expect(body.role).toBe("owner");

    expect(mocks.userCreate).toHaveBeenCalledOnce();
    expect(mocks.workspaceCreate).toHaveBeenCalledOnce();
    expect(mocks.memberCreate).toHaveBeenCalledOnce();
  });

  test("200 attached=true sur user existant — réutilise user_id", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: "t-1" });
    mocks.userFindFirst.mockResolvedValueOnce({ id: "u-existing" });
    mocks.workspaceFindFirst.mockResolvedValueOnce({ id: "ws-1" });
    mocks.memberFindUnique.mockResolvedValueOnce(null);
    mocks.memberCreate.mockResolvedValueOnce({});

    const { raw, headers } = signed({
      tenant_id: "t-1",
      owner_email: "owner@example.com",
    });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { user_id: string };
    expect(body.user_id).toBe("u-existing");
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.memberCreate.mock.calls[0][0].data.role).toBe("owner");
  });

  test("200 already_attached=true si user déjà owner (additif : pas d'update)", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: "t-1" });
    mocks.userFindFirst.mockResolvedValueOnce({ id: "u-existing" });
    mocks.workspaceFindFirst.mockResolvedValueOnce({ id: "ws-1" });
    mocks.memberFindUnique.mockResolvedValueOnce({ role: "owner" });

    const { raw, headers } = signed({
      tenant_id: "t-1",
      owner_email: "owner@example.com",
      role: "owner",
    });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      attached: boolean;
      already_attached: boolean;
      role: string;
    };
    expect(body.already_attached).toBe(true);
    expect(body.attached).toBe(false);
    expect(body.role).toBe("owner");
    expect(mocks.memberUpdate).not.toHaveBeenCalled();
    expect(mocks.memberCreate).not.toHaveBeenCalled();
  });

  test("200 upgrade si user existait avec role inférieur (member → owner)", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: "t-1" });
    mocks.userFindFirst.mockResolvedValueOnce({ id: "u-1" });
    mocks.workspaceFindFirst.mockResolvedValueOnce({ id: "ws-1" });
    mocks.memberFindUnique.mockResolvedValueOnce({ role: "member" });
    mocks.memberUpdate.mockResolvedValueOnce({});

    const { raw, headers } = signed({
      tenant_id: "t-1",
      owner_email: "owner@example.com",
      role: "owner",
    });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    expect(mocks.memberUpdate).toHaveBeenCalledOnce();
    expect(mocks.memberUpdate.mock.calls[0][0].data.role).toBe("owner");
  });

  test("additif : ne downgrade pas un owner existant si on demande admin", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({ id: "t-1" });
    mocks.userFindFirst.mockResolvedValueOnce({ id: "u-1" });
    mocks.workspaceFindFirst.mockResolvedValueOnce({ id: "ws-1" });
    mocks.memberFindUnique.mockResolvedValueOnce({ role: "owner" });

    const { raw, headers } = signed({
      tenant_id: "t-1",
      owner_email: "owner@example.com",
      role: "admin",
    });
    const res = await POST(req(raw, headers));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { role: string };
    expect(body.role).toBe("owner");
    expect(mocks.memberUpdate).not.toHaveBeenCalled();
  });
});
