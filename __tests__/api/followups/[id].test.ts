/**
 * Tests de PATCH /api/followups/[id].
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAuthMock, getTenantIdMock, getWorkspaceScopeMock, queriesMock } = vi.hoisted(
  () => ({
    requireAuthMock: vi.fn(),
    getTenantIdMock: vi.fn(),
    getWorkspaceScopeMock: vi.fn(),
    queriesMock: { updateFollowup: vi.fn() },
  }),
);

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/queries", () => queriesMock);

import { PATCH } from "@/app/api/followups/[id]/route";
import { makeRequest } from "../_helpers";

const params = { params: Promise.resolve({ id: "42" }) };

describe("PATCH /api/followups/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await PATCH(
      makeRequest("/api/followups/42", { method: "PATCH", body: {} }),
      params,
    );
    expect(res.status).toBe(401);
  });

  test("returns 400 when status and note both missing", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getWorkspaceScopeMock.mockResolvedValue({ filter: null });
    const res = await PATCH(
      makeRequest("/api/followups/42", { method: "PATCH", body: {} }),
      params,
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 on invalid status value", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getWorkspaceScopeMock.mockResolvedValue({ filter: null });
    const res = await PATCH(
      makeRequest("/api/followups/42", {
        method: "PATCH",
        body: { status: "garbage" },
      }),
      params,
    );
    expect(res.status).toBe(400);
  });

  test("returns 200 on valid status update", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getWorkspaceScopeMock.mockResolvedValue({ filter: null });
    queriesMock.updateFollowup.mockResolvedValue(undefined);
    const res = await PATCH(
      makeRequest("/api/followups/42", {
        method: "PATCH",
        body: { status: "done" },
      }),
      params,
    );
    expect(res.status).toBe(200);
    expect(queriesMock.updateFollowup).toHaveBeenCalledWith(
      42,
      { status: "done", note: undefined },
      "t-1",
      null,
    );
  });
});
