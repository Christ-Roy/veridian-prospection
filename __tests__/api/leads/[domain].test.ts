/**
 * Tests de GET /api/leads/[domain] (lead detail + rate limit).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getTenantProspectLimitMock,
  getWorkspaceScopeMock,
  isRateLimitedMock,
  queriesMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getTenantProspectLimitMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  isRateLimitedMock: vi.fn(),
  queriesMock: { getLeadDetail: vi.fn(), recordVisit: vi.fn() },
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
vi.mock("@/lib/queries", () => queriesMock);

import { GET } from "@/app/api/leads/[domain]/route";
import { makeRequest } from "../_helpers";

const params = { params: Promise.resolve({ domain: "123456789" }) };

describe("GET /api/leads/[domain]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
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
});
