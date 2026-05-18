/**
 * Tests de GET /api/invitations/[token] (lookup public, sans auth).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { getInvitationByTokenMock, prismaMock } = vi.hoisted(() => ({
  getInvitationByTokenMock: vi.fn(),
  prismaMock: {
    workspace: { findFirst: vi.fn(), findUnique: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/invitations", () => ({
  getInvitationByToken: getInvitationByTokenMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

import { GET } from "@/app/api/invitations/[token]/route";

const params = { params: Promise.resolve({ token: "tok-1" }) };

describe("GET /api/invitations/[token]", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 404 when token unknown", async () => {
    getInvitationByTokenMock.mockResolvedValue(null);
    const res = await GET(new Request("http://x/"), params);
    expect(res.status).toBe(404);
  });

  test("returns 200 + invitation shape on valid token", async () => {
    getInvitationByTokenMock.mockResolvedValue({
      id: 1,
      email: "x@y.fr",
      role: "member",
      workspace_id: null,
      invited_by: "u-1",
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
      accepted_at: null,
      revoked_at: null,
    });
    prismaMock.user.findUnique.mockResolvedValue({ email: "inviter@v.site" });
    const res = await GET(new Request("http://x/"), params);
    expect(res.status).toBe(200);
  });
});
