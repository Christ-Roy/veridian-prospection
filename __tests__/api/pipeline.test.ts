/**
 * Tests des routes /api/pipeline (GET, PUT).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getWorkspaceScopeMock,
  getUserContextMock,
  queriesMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  getUserContextMock: vi.fn(),
  queriesMock: {
    getPipelineLeads: vi.fn(),
    getPipelineColumnOrder: vi.fn(),
    savePipelineColumnOrder: vi.fn(),
    reorderPipelineCards: vi.fn(),
    batchReorderPipelineCards: vi.fn(),
  },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
  getUserContext: getUserContextMock,
}));
vi.mock("@/lib/queries", () => queriesMock);

import { GET, PUT } from "@/app/api/pipeline/route";
import { makeRequest } from "./_helpers";

function gReq(url = "https://app.test/api/pipeline") {
  return new NextRequest(url);
}

describe("/api/pipeline", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET(gReq());
      expect(res.status).toBe(401);
    });

    test("filters by current user (mine mode) for non-admin", async () => {
      requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
      getTenantIdMock.mockResolvedValue("t-1");
      getUserContextMock.mockResolvedValue({
        isAdmin: false,
        workspaces: [{ id: "w-1", visibilityScope: "own" }],
        activeWorkspaceId: "w-1",
      });
      getWorkspaceScopeMock.mockResolvedValue({ filter: null });
      queriesMock.getPipelineLeads.mockResolvedValue({});
      queriesMock.getPipelineColumnOrder.mockResolvedValue([]);
      const res = await GET(gReq());
      expect(res.status).toBe(200);
      expect(queriesMock.getPipelineLeads).toHaveBeenCalledWith("t-1", null, "u-1");
    });

    test("visibility_scope='all' shows team pipeline", async () => {
      requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
      getTenantIdMock.mockResolvedValue("t-1");
      getUserContextMock.mockResolvedValue({
        isAdmin: false,
        workspaces: [{ id: "w-1", visibilityScope: "all" }],
        activeWorkspaceId: "w-1",
      });
      getWorkspaceScopeMock.mockResolvedValue({ filter: null });
      queriesMock.getPipelineLeads.mockResolvedValue({});
      queriesMock.getPipelineColumnOrder.mockResolvedValue([]);
      const res = await GET(gReq());
      expect(res.status).toBe(200);
      expect(queriesMock.getPipelineLeads).toHaveBeenCalledWith("t-1", null, null);
    });
  });

  describe("PUT", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await PUT(makeRequest("/api/pipeline", { method: "PUT", body: {} }));
      expect(res.status).toBe(401);
    });

    test("returns 200 on column order save", async () => {
      requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
      getTenantIdMock.mockResolvedValue("t-1");
      getWorkspaceScopeMock.mockResolvedValue({ filter: null });
      queriesMock.savePipelineColumnOrder.mockResolvedValue(undefined);

      const res = await PUT(
        makeRequest("/api/pipeline", {
          method: "PUT",
          body: { columnOrder: ["a", "b"] },
        }),
      );
      expect(res.status).toBe(200);
      expect(queriesMock.savePipelineColumnOrder).toHaveBeenCalledWith(
        ["a", "b"],
        "t-1",
      );
    });
  });
});
