/**
 * Tests de GET /api/segments.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  cachedMock,
  getAllSegmentCountsMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  cachedMock: vi.fn(
    async <T>(_k: string, _ttl: number, fn: () => Promise<T>) => fn(),
  ),
  getAllSegmentCountsMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/cache", () => ({ cached: cachedMock }));
vi.mock("@/lib/queries", () => ({ getAllSegmentCounts: getAllSegmentCountsMock }));
vi.mock("@/lib/segments", () => ({ getAllSegments: () => [] }));

import { GET } from "@/app/api/segments/route";

describe("GET /api/segments", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns segment counts from cached query", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getAllSegmentCountsMock.mockResolvedValue({});
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
