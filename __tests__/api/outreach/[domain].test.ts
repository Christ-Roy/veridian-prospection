/**
 * Tests des routes /api/outreach/[domain] (PUT, PATCH).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getWorkspaceScopeMock,
  queriesMock,
  invalidateMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  queriesMock: { updateOutreach: vi.fn(), patchOutreach: vi.fn() },
  invalidateMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/queries", () => queriesMock);
vi.mock("@/lib/cache", () => ({ invalidate: invalidateMock }));

import { PUT, PATCH } from "@/app/api/outreach/[domain]/route";
import { makeRequest } from "../_helpers";

const params = { params: Promise.resolve({ domain: "123456789" }) };

describe("/api/outreach/[domain]", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("PUT", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await PUT(
        makeRequest("/api/outreach/123456789", { method: "PUT", body: {} }),
        params,
      );
      expect(res.status).toBe(401);
    });

    test("returns 200 + invalidates stats on success", async () => {
      requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
      getTenantIdMock.mockResolvedValue("t-1");
      getWorkspaceScopeMock.mockResolvedValue({ insertId: "ws-1" });

      const res = await PUT(
        makeRequest("/api/outreach/123456789", {
          method: "PUT",
          body: { status: "contacte", notes: "appel court" },
        }),
        params,
      );
      expect(res.status).toBe(200);
      expect(queriesMock.updateOutreach).toHaveBeenCalled();
      expect(invalidateMock).toHaveBeenCalledWith("stats");
    });
  });

  describe("PATCH", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await PATCH(
        makeRequest("/api/outreach/123456789", { method: "PATCH", body: {} }),
        params,
      );
      expect(res.status).toBe(401);
    });
  });
});
