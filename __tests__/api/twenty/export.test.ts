/**
 * Tests de POST /api/twenty/export.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAuthMock, getTenantIdMock, queriesMock, twentyMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  queriesMock: { getLeadsByDomains: vi.fn() },
  twentyMock: { exportToTwenty: vi.fn() },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/queries", () => queriesMock);
vi.mock("@/lib/twenty", () => twentyMock);

import { POST } from "@/app/api/twenty/export/route";
import { makeRequest } from "../_helpers";

describe("POST /api/twenty/export", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/twenty/export", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 400 when domains[] is empty", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    const res = await POST(
      makeRequest("/api/twenty/export", { method: "POST", body: { domains: [] } }),
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 when more than 500 domains", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    const tooMany = Array(501).fill("x.fr");
    const res = await POST(
      makeRequest("/api/twenty/export", {
        method: "POST",
        body: { domains: tooMany },
      }),
    );
    expect(res.status).toBe(400);
  });
});
