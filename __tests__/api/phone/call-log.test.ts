/**
 * Tests de POST /api/phone/call-log.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getWorkspaceScopeMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  prismaMock: { callLog: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() } },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { POST } from "@/app/api/phone/call-log/route";
import { makeRequest } from "../_helpers";

describe("POST /api/phone/call-log", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(makeRequest("/api/phone/call-log", { method: "POST", body: {} }));
    expect(res.status).toBe(401);
  });
});
