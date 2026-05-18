/**
 * Tests des routes /api/entreprises/[siren]/claude (GET, POST).
 *
 * STUB — la route renvoie 501 (Phase 3 SIREN refactor pas implémenté).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));

import { GET, POST } from "@/app/api/entreprises/[siren]/claude/route";
import { makeUserContext } from "../../_helpers";

describe("/api/entreprises/[siren]/claude", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireUserMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET(new Request("http://x/"), {
        params: Promise.resolve({ siren: "123456789" }),
      });
      expect(res.status).toBe(401);
    });

    test("returns 400 on invalid SIREN", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
      const res = await GET(new Request("http://x/"), {
        params: Promise.resolve({ siren: "abc" }),
      });
      expect(res.status).toBe(400);
    });

    test("returns 501 stub for valid auth + SIREN", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
      const res = await GET(new Request("http://x/"), {
        params: Promise.resolve({ siren: "123456789" }),
      });
      expect(res.status).toBe(501);
    });
  });

  describe("POST", () => {
    test("returns 501 stub", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
      const res = await POST(new Request("http://x/", { method: "POST" }), {
        params: Promise.resolve({ siren: "123456789" }),
      });
      expect(res.status).toBe(501);
    });
  });
});
