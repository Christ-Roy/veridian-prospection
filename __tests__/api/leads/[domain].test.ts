/**
 * Tests de GET + PATCH /api/leads/[domain] (lead detail, rate limit,
 * changement de statut prospect).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getTenantProspectLimitMock,
  getWorkspaceScopeMock,
  isRateLimitedMock,
  isUserFrozenMock,
  checkTrialExpiredMock,
  queriesMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getTenantProspectLimitMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  isRateLimitedMock: vi.fn(),
  isUserFrozenMock: vi.fn(),
  checkTrialExpiredMock: vi.fn(),
  queriesMock: {
    getLeadDetail: vi.fn(),
    recordVisit: vi.fn(),
    patchOutreach: vi.fn(),
    consumeLead: vi.fn(),
  },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({
  getTenantId: getTenantIdMock,
  getTenantProspectLimit: getTenantProspectLimitMock,
}));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/auth/freeze", () => ({ isUserFrozen: isUserFrozenMock }));
vi.mock("@/lib/trial", () => ({ checkTrialExpired: checkTrialExpiredMock }));
vi.mock("@/lib/queries", () => queriesMock);

import { GET, PATCH } from "@/app/api/leads/[domain]/route";
import { makeRequest } from "../_helpers";

const params = { params: Promise.resolve({ domain: "123456789" }) };

describe("GET /api/leads/[domain]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
    // consumeLead est appelée en fire-and-forget après recordVisit : doit
    // toujours renvoyer une promesse (sinon le `.catch()` du handler throw).
    queriesMock.consumeLead.mockResolvedValue(true);
  });

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(makeRequest("/api/leads/123456789"), params);
    expect(res.status).toBe(401);
  });

  test("returns 429 when rate-limited", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    isRateLimitedMock.mockReturnValue(true);
    const res = await GET(makeRequest("/api/leads/123456789"), params);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  test("obfusque SENSITIVE_FIELDS si user freezed (§5.21 cross-app)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("tenant-1");
    getTenantProspectLimitMock.mockResolvedValue(99999); // plan payant → pas trial expired
    getWorkspaceScopeMock.mockResolvedValue({ insertId: "ws-1" });
    queriesMock.getLeadDetail.mockResolvedValue({
      siren: "123456789",
      email: "contact@target.com",
      phone: "0123456789",
      dirigeant: "Jean Dupont",
    });
    queriesMock.recordVisit.mockResolvedValue(undefined);
    isUserFrozenMock.mockResolvedValue(true);

    const res = await GET(makeRequest("/api/leads/123456789"), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    // Champ obfusqué : prefix 33% conservé + reste en bullets.
    expect(body.email).not.toBe("contact@target.com");
    expect(body.email).toMatch(/^c{0,5}.*•+$/);
    expect(body.phone).not.toBe("0123456789");
    expect(isUserFrozenMock).toHaveBeenCalledWith("u-1", "tenant-1");
  });

  test("ne hit pas isUserFrozen si tenantId null (early skip)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue(null);
    getTenantProspectLimitMock.mockResolvedValue(99999);
    getWorkspaceScopeMock.mockResolvedValue({ insertId: "ws-1" });
    queriesMock.getLeadDetail.mockResolvedValue({
      siren: "123456789",
      email: "contact@target.com",
    });
    queriesMock.recordVisit.mockResolvedValue(undefined);

    const res = await GET(makeRequest("/api/leads/123456789"), params);
    expect(res.status).toBe(200);
    expect(isUserFrozenMock).not.toHaveBeenCalled();
  });

  test("consomme 1 lead à la consultation (décompte quota refill)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("tenant-1");
    getTenantProspectLimitMock.mockResolvedValue(99999);
    getWorkspaceScopeMock.mockResolvedValue({ insertId: "ws-1" });
    queriesMock.getLeadDetail.mockResolvedValue({ siren: "123456789" });
    queriesMock.recordVisit.mockResolvedValue(undefined);

    const res = await GET(makeRequest("/api/leads/123456789"), params);
    expect(res.status).toBe(200);
    // consumeLead reçoit siren, tenantId, workspaceId — l'idempotence
    // par (workspace, siren) est gérée côté lib, pas ici.
    expect(queriesMock.consumeLead).toHaveBeenCalledWith(
      "123456789",
      "tenant-1",
      "ws-1",
    );
  });

  test("un échec du décompte ne casse pas la consultation (fail-safe)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("tenant-1");
    getTenantProspectLimitMock.mockResolvedValue(99999);
    getWorkspaceScopeMock.mockResolvedValue({ insertId: "ws-1" });
    queriesMock.getLeadDetail.mockResolvedValue({ siren: "123456789" });
    queriesMock.recordVisit.mockResolvedValue(undefined);
    // consumeLead rejette : la fiche doit quand même être servie.
    queriesMock.consumeLead.mockRejectedValue(new Error("db down"));

    const res = await GET(makeRequest("/api/leads/123456789"), params);
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/leads/[domain]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Auth + scope OK par défaut — chaque test surcharge ce qu'il veut.
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("tenant-1");
    getWorkspaceScopeMock.mockResolvedValue({ insertId: "ws-1" });
    queriesMock.patchOutreach.mockResolvedValue(undefined);
  });

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await PATCH(
      makeRequest("/api/leads/123456789", {
        method: "PATCH",
        body: { status: "fiche_ouverte" },
      }),
      params,
    );
    expect(res.status).toBe(401);
    // Auth refusée → aucune écriture DB.
    expect(queriesMock.patchOutreach).not.toHaveBeenCalled();
  });

  test("change le statut et scope l'update au tenant courant", async () => {
    const res = await PATCH(
      makeRequest("/api/leads/123456789", {
        method: "PATCH",
        body: { status: "fiche_ouverte" },
      }),
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // patchOutreach appelée avec siren, body {status}, tenant, workspace, user.
    expect(queriesMock.patchOutreach).toHaveBeenCalledWith(
      "123456789",
      { status: "fiche_ouverte" },
      "tenant-1",
      "ws-1",
      "u-1",
    );
  });

  test("rejette en 400 un status inconnu (jamais écrit en DB)", async () => {
    const res = await PATCH(
      makeRequest("/api/leads/123456789", {
        method: "PATCH",
        body: { status: "n_importe_quoi" },
      }),
      params,
    );
    expect(res.status).toBe(400);
    // Validation amont → patchOutreach jamais appelée.
    expect(queriesMock.patchOutreach).not.toHaveBeenCalled();
  });

  test("rejette en 400 si status manquant", async () => {
    const res = await PATCH(
      makeRequest("/api/leads/123456789", {
        method: "PATCH",
        body: { notes: "sans status" },
      }),
      params,
    );
    expect(res.status).toBe(400);
    expect(queriesMock.patchOutreach).not.toHaveBeenCalled();
  });

  test("rejette en 400 si status n'est pas une string", async () => {
    const res = await PATCH(
      makeRequest("/api/leads/123456789", {
        method: "PATCH",
        body: { status: 42 },
      }),
      params,
    );
    expect(res.status).toBe(400);
    expect(queriesMock.patchOutreach).not.toHaveBeenCalled();
  });

  test("ne crash pas sur JSON malformé → 400 (body vide = status manquant)", async () => {
    const res = await PATCH(
      makeRequest("/api/leads/123456789", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{not valid json",
      }),
      params,
    );
    // Safe-parse → {} → status manquant → 400, pas de 500.
    expect(res.status).toBe(400);
    expect(queriesMock.patchOutreach).not.toHaveBeenCalled();
  });
});
