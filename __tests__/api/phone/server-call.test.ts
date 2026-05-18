/**
 * Tests des routes /api/phone/server-call (POST, GET, DELETE).
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
  prismaMock: {
    callLog: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { POST, GET, DELETE } from "@/app/api/phone/server-call/route";
import { makeRequest } from "../_helpers";

describe("/api/phone/server-call", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("POST", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await POST(
        makeRequest("/api/phone/server-call", { method: "POST", body: {} }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET();
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await DELETE();
      expect(res.status).toBe(401);
    });
  });
});
