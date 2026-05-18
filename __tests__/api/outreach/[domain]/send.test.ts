/**
 * Tests de POST /api/outreach/[domain]/send.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getWorkspaceScopeMock,
  queriesMock,
  prismaMock,
  invalidateMock,
  execSyncMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  queriesMock: {
    updateOutreach: vi.fn(),
    addClaudeActivity: vi.fn(),
    addFollowup: vi.fn(),
    addOutreachEmail: vi.fn(),
  },
  prismaMock: { entreprise: { findUnique: vi.fn() } },
  invalidateMock: vi.fn(),
  execSyncMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({ getWorkspaceScope: getWorkspaceScopeMock }));
vi.mock("@/lib/queries", () => queriesMock);
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/cache", () => ({ invalidate: invalidateMock }));
vi.mock("child_process", () => ({ execSync: execSyncMock }));

import { POST } from "@/app/api/outreach/[domain]/send/route";
import { makeRequest } from "../../_helpers";

const params = { params: Promise.resolve({ domain: "123456789" }) };

describe("POST /api/outreach/[domain]/send", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/outreach/123456789/send", { method: "POST", body: {} }),
      params,
    );
    expect(res.status).toBe(401);
  });

  test("returns 400 when to/subject/body missing", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getWorkspaceScopeMock.mockResolvedValue({ insertId: "ws-1" });
    const res = await POST(
      makeRequest("/api/outreach/123456789/send", {
        method: "POST",
        body: { to: "x@y.fr" },
      }),
      params,
    );
    expect(res.status).toBe(400);
  });
});
