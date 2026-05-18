/**
 * Tests de la route GET /api/me.
 *
 * Couvre :
 *  - 401 quand aucune session
 *  - 200 + shape attendue (userId/email/isAdmin/tenantId/workspaces) quand session présente
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { getUserContextMock } = vi.hoisted(() => ({
  getUserContextMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({
  getUserContext: getUserContextMock,
}));

import { GET } from "@/app/api/me/route";
import { makeUserContext, readJson } from "./_helpers";

describe("GET /api/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 401 when no session", async () => {
    getUserContextMock.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  test("returns 200 with user context shape when authenticated", async () => {
    const ctx = makeUserContext({
      userId: "u-1",
      email: "u@v.site",
      tenantId: "t-1",
      isAdmin: true,
      activeWorkspaceId: "ws-1",
    });
    getUserContextMock.mockResolvedValue(ctx);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.userId).toBe("u-1");
    expect(body.email).toBe("u@v.site");
    expect(body.isAdmin).toBe(true);
    expect(body.tenantId).toBe("t-1");
    expect(body.activeWorkspaceId).toBe("ws-1");
    expect(Array.isArray(body.workspaces)).toBe(true);
  });
});
