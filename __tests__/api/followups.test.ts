/**
 * Tests des routes /api/followups (GET, POST).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAuthMock, getTenantIdMock, getWorkspaceScopeMock, queriesMock } = vi.hoisted(
  () => ({
    requireAuthMock: vi.fn(),
    getTenantIdMock: vi.fn(),
    getWorkspaceScopeMock: vi.fn(),
    queriesMock: { getFollowups: vi.fn(), addFollowup: vi.fn() },
  }),
);

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/queries", () => queriesMock);

import { GET, POST } from "@/app/api/followups/route";
import { makeRequest, readJson } from "./_helpers";

describe("/api/followups", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET(makeRequest("/api/followups"));
      expect(res.status).toBe(401);
    });

    test("returns followups list for authed user", async () => {
      requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
      getTenantIdMock.mockResolvedValue("t-1");
      getWorkspaceScopeMock.mockResolvedValue({ filter: null, insertId: null });
      queriesMock.getFollowups.mockResolvedValue([]);
      const res = await GET(makeRequest("/api/followups?siren=123456789"));
      expect(res.status).toBe(200);
      expect(queriesMock.getFollowups).toHaveBeenCalledWith("123456789", "t-1", null);
    });
  });

  describe("POST", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await POST(
        makeRequest("/api/followups", { method: "POST", body: {} }),
      );
      expect(res.status).toBe(401);
    });

    test("returns 400 when siren or scheduled_at missing", async () => {
      requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
      getTenantIdMock.mockResolvedValue("t-1");
      getWorkspaceScopeMock.mockResolvedValue({ filter: null, insertId: null });
      const res = await POST(
        makeRequest("/api/followups", { method: "POST", body: { siren: "123456789" } }),
      );
      expect(res.status).toBe(400);
      const body = (await readJson(res)) as { error: string };
      expect(body.error).toContain("required");
    });

    test("returns 201 on valid followup creation", async () => {
      requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
      getTenantIdMock.mockResolvedValue("t-1");
      getWorkspaceScopeMock.mockResolvedValue({ filter: null, insertId: "ws-1" });
      queriesMock.addFollowup.mockResolvedValue({ id: 1, siren: "123456789" });
      const res = await POST(
        makeRequest("/api/followups", {
          method: "POST",
          body: { siren: "123456789", scheduled_at: "2026-06-01" },
        }),
      );
      expect(res.status).toBe(201);
    });
  });
});
