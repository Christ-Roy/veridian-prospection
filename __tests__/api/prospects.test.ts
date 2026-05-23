/**
 * Tests de GET /api/prospects (liste prospects filtrée + quota freemium).
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

  test("returns prospects list with default pagination", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getTenantProspectLimitMock.mockResolvedValue(null); // pro plan, no quota
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
    queriesMock.getProspects.mockResolvedValue({
      results: [{ siren: "123456789", denomination: "ACME" }],
      total: 1,
    });
    queriesMock.getDomainCounts.mockResolvedValue({});
    queriesMock.getPresetCounts.mockResolvedValue({});
    queriesMock.getAllSettings.mockResolvedValue({});

    const res = await GET(makeRequest("/api/prospects?limit=20"));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.results || body.prospects).toBeTruthy();
  });
});
