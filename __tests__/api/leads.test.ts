/**
 * Tests de GET /api/leads (liste paginée).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getTenantProspectLimitMock,
  queriesMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getTenantProspectLimitMock: vi.fn(),
  queriesMock: { getLeads: vi.fn() },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({
  getTenantId: getTenantIdMock,
  getTenantProspectLimit: getTenantProspectLimitMock,
}));
vi.mock("@/lib/queries", () => queriesMock);

import { GET } from "@/app/api/leads/route";
import { makeRequest } from "./_helpers";

describe("GET /api/leads", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(makeRequest("/api/leads"));
    expect(res.status).toBe(401);
  });

  test("returns leads paginated", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getTenantProspectLimitMock.mockResolvedValue(null);
    queriesMock.getLeads.mockResolvedValue({ results: [], total: 0 });
    const res = await GET(makeRequest("/api/leads?page=2&pageSize=50"));
    expect(res.status).toBe(200);
  });
});
