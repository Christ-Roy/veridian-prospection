/**
 * Tests de PUT /api/claude/[domain]/[id].
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getWorkspaceScopeMock,
  queriesMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  queriesMock: { updateClaudeActivity: vi.fn() },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/queries", () => queriesMock);

import { PUT } from "@/app/api/claude/[domain]/[id]/route";
import { makeRequest } from "../../_helpers";

const params = {
  params: Promise.resolve({ domain: "123456789", id: "42" }),
};

describe("PUT /api/claude/[domain]/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await PUT(
      makeRequest("/api/claude/123456789/42", { method: "PUT", body: {} }),
      params,
    );
    expect(res.status).toBe(401);
  });
});
