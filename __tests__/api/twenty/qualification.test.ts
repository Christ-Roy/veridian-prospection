/**
 * Tests des routes /api/twenty/qualification (GET, PUT).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAuthMock, getTenantIdMock, twentyMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  twentyMock: { getQualifications: vi.fn(), updateQualification: vi.fn() },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/twenty", () => twentyMock);

import { GET, PUT } from "@/app/api/twenty/qualification/route";
import { makeRequest } from "../_helpers";

describe("/api/twenty/qualification", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET(makeRequest("/api/twenty/qualification?domains=x.fr"));
      expect(res.status).toBe(401);
    });

    test("returns 400 when domains param missing", async () => {
      requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
      getTenantIdMock.mockResolvedValue("t-1");
      const res = await GET(makeRequest("/api/twenty/qualification"));
      expect(res.status).toBe(400);
    });
  });

  describe("PUT", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await PUT(
        makeRequest("/api/twenty/qualification", { method: "PUT", body: {} }),
      );
      expect(res.status).toBe(401);
    });
  });
});
