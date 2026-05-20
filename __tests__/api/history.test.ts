/**
 * Tests de GET /api/history.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { requireAuthMock, getTenantIdMock, getHistoryLeadsMock, getUserContextMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getHistoryLeadsMock: vi.fn(),
  getUserContextMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/queries", () => ({ getHistoryLeads: getHistoryLeadsMock }));
vi.mock("@/lib/auth/user-context", () => ({ getUserContext: getUserContextMock }));

import { GET } from "@/app/api/history/route";

function req(url = "https://app.test/api/history") {
  return new NextRequest(url);
}

describe("GET /api/history", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  test("filters by user_id for non-admin", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getUserContextMock.mockResolvedValue({ isAdmin: false, workspaces: [] });
    getHistoryLeadsMock.mockResolvedValue([]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(getHistoryLeadsMock).toHaveBeenCalledWith(200, "t-1", "u-1");
  });

  test("admin with ?showAll=1 sees all tenant outreach", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-admin", email: "a@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getUserContextMock.mockResolvedValue({ isAdmin: true, workspaces: [] });
    getHistoryLeadsMock.mockResolvedValue([]);
    const res = await GET(req("https://app.test/api/history?showAll=1"));
    expect(res.status).toBe(200);
    expect(getHistoryLeadsMock).toHaveBeenCalledWith(200, "t-1", null);
  });

  test("renvoie Cache-Control: no-store (anti désync UI)", async () => {
    // Sans no-store, le navigateur peut cacher la réponse plusieurs minutes
    // via heuristique HTTP. Un commercial qui passe du kanban à /historique
    // doit voir le statut à jour immédiatement.
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getUserContextMock.mockResolvedValue({ isAdmin: false, workspaces: [] });
    getHistoryLeadsMock.mockResolvedValue([]);
    const res = await GET(req());
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});
