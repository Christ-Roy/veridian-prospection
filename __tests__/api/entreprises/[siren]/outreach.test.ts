/**
 * Tests des routes /api/entreprises/[siren]/outreach (GET, POST, PATCH).
 *
 * STUB — Phase 3 SIREN refactor pas implémenté (renvoie 501).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));

import { GET, POST, PATCH } from "@/app/api/entreprises/[siren]/outreach/route";
import { makeUserContext } from "../../_helpers";

const validParams = { params: Promise.resolve({ siren: "123456789" }) };

describe("/api/entreprises/[siren]/outreach", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireUserMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET(new Request("http://x/"), validParams);
      expect(res.status).toBe(401);
    });

    test("returns 400 on invalid SIREN", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
      const res = await GET(new Request("http://x/"), {
        params: Promise.resolve({ siren: "abc" }),
      });
      expect(res.status).toBe(400);
    });

    test("returns 501 stub", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
      const res = await GET(new Request("http://x/"), validParams);
      expect(res.status).toBe(501);
    });
  });

  describe("POST", () => {
    test("returns 501 stub", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
      const res = await POST(new Request("http://x/", { method: "POST" }), validParams);
      expect(res.status).toBe(501);
    });
  });

  describe("PATCH", () => {
    test("returns 501 stub", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
      const res = await PATCH(new Request("http://x/", { method: "PATCH" }), validParams);
      expect(res.status).toBe(501);
    });
  });
});
