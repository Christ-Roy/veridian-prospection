/**
 * Tests de GET /api/prospects (liste prospects filtrée + quota freemium).
 *
 * Pattern fort : assert sur le BODY RETOURNÉ (shape exact, valeurs), pas
 * juste sur res.status (bug invitations 2026-05-23).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getTenantProspectLimitMock,
  getWorkspaceScopeMock,
  getUserContextMock,
  cachedMock,
  isRateLimitedMock,
  queriesMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getTenantProspectLimitMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  getUserContextMock: vi.fn(),
  cachedMock: vi.fn(
    async <T>(_k: string, _ttl: number, fn: () => Promise<T>) => fn(),
  ),
  isRateLimitedMock: vi.fn().mockReturnValue(false),
  queriesMock: {
    getProspects: vi.fn(),
    getDomainCounts: vi.fn(),
    getPresetCounts: vi.fn(),
    getAllSettings: vi.fn(),
  },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({
  getTenantId: getTenantIdMock,
  getTenantProspectLimit: getTenantProspectLimitMock,
}));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
  getUserContext: getUserContextMock,
}));
vi.mock("@/lib/cache", () => ({ cached: cachedMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/queries", () => queriesMock);

import { GET } from "@/app/api/prospects/route";
import { makeRequest, readJson } from "./_helpers";

function defaultAuthCtx() {
  requireAuthMock.mockResolvedValue({
    user: { id: "u-1", email: "u@v.site" },
  });
  getTenantIdMock.mockResolvedValue("t-1");
  getTenantProspectLimitMock.mockResolvedValue(100000); // pro plan
  getWorkspaceScopeMock.mockResolvedValue({
    ctx: { tenantId: "t-1" },
    filter: null,
    insertId: null,
  });
  getUserContextMock.mockResolvedValue({
    userId: "u-1",
    tenantId: "t-1",
    isAdmin: false,
    workspaces: [],
    activeWorkspaceId: null,
  });
  queriesMock.getAllSettings.mockResolvedValue({});
}

describe("GET /api/prospects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  test("returns 401 when not authenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(makeRequest("/api/prospects"));
    expect(res.status).toBe(401);
  });

  test("returns 429 when rate-limited", async () => {
    defaultAuthCtx();
    isRateLimitedMock.mockReturnValue(true);
    const res = await GET(makeRequest("/api/prospects"));
    expect(res.status).toBe(429);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toMatch(/Trop de requetes/);
  });

  test("returns prospects list — shape canonique {data, total} préservé", async () => {
    defaultAuthCtx();
    queriesMock.getProspects.mockResolvedValue({
      data: [
        { siren: "123456789", denomination: "ACME" },
        { siren: "987654321", denomination: "BETA" },
      ],
      total: 2,
    });

    const res = await GET(makeRequest("/api/prospects?limit=20"));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    // Shape canonique : la route fait JSON.parse(JSON.stringify(payload))
    // donc on récupère exactement le shape de getProspects.
    expect(body).toEqual({
      data: [
        { siren: "123456789", denomination: "ACME" },
        { siren: "987654321", denomination: "BETA" },
      ],
      total: 2,
    });
    expect(queriesMock.getProspects).toHaveBeenCalled();
  });

  test("action=domain-counts retourne les counts au lieu d'une liste", async () => {
    defaultAuthCtx();
    queriesMock.getDomainCounts.mockResolvedValue({
      btp: 100,
      sante: 42,
    });

    const res = await GET(
      makeRequest("/api/prospects?action=domain-counts"),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, number>;
    expect(body).toEqual({ btp: 100, sante: 42 });
    expect(queriesMock.getProspects).not.toHaveBeenCalled();
  });

  test("action=preset-counts retourne les counts par preset", async () => {
    defaultAuthCtx();
    queriesMock.getPresetCounts.mockResolvedValue({
      top_prospects: 50,
      btp_artisans: 12,
    });

    const res = await GET(
      makeRequest("/api/prospects?action=preset-counts&domain=btp"),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, number>;
    expect(body).toEqual({ top_prospects: 50, btp_artisans: 12 });
  });

  test("BigInt depuis Prisma est sérialisé en Number dans le body JSON", async () => {
    defaultAuthCtx();
    queriesMock.getProspects.mockResolvedValue({
      data: [{ siren: "111111111", ca: 50000n }], // bigint Prisma
      total: 1,
    });

    const res = await GET(makeRequest("/api/prospects"));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      data: Array<{ siren: string; ca: number }>;
    };
    // BigInt converti en Number — assertion forte sur le type ET la valeur.
    expect(body.data[0].ca).toBe(50000);
    expect(typeof body.data[0].ca).toBe("number");
  });
});
