/**
 * Tests des routes /api/segments/[...slug] (GET, POST, DELETE).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  queriesMock,
  invalidateMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  queriesMock: {
    getSegmentLeads: vi.fn(),
    addToSegment: vi.fn(),
    removeFromSegment: vi.fn(),
  },
  invalidateMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/queries", () => queriesMock);
vi.mock("@/lib/cache", () => ({ invalidate: invalidateMock }));

import { GET, POST, DELETE } from "@/app/api/segments/[...slug]/route";
import { makeRequest } from "../_helpers";

const params = { params: Promise.resolve({ slug: ["a-corriger"] }) };

describe("/api/segments/[...slug]", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET(makeRequest("/api/segments/x"), params);
      expect(res.status).toBe(401);
    });
  });

  describe("POST", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await POST(
        makeRequest("/api/segments/x", { method: "POST", body: {} }),
        params,
      );
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await DELETE(
        makeRequest("/api/segments/x", { method: "DELETE" }),
        params,
      );
      expect(res.status).toBe(401);
    });
  });
});
