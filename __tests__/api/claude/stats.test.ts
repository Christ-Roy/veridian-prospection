/**
 * Tests de GET /api/claude/stats.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getWorkspaceScopeMock,
  cachedMock,
  queriesMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  cachedMock: vi.fn(
    async <T>(_k: string, _ttl: number, fn: () => Promise<T>) => fn(),
  ),
  queriesMock: { getClaudeStats: vi.fn() },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/cache", () => ({ cached: cachedMock }));
vi.mock("@/lib/queries", () => queriesMock);

import { GET } from "@/app/api/claude/stats/route";

describe("GET /api/claude/stats", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns stats from cached query", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getWorkspaceScopeMock.mockResolvedValue({ filter: null });
    queriesMock.getClaudeStats.mockResolvedValue({ total: 0 });
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
