/**
 * Tests des routes /api/user/notification-preferences (GET, PUT).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, prismaMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  prismaMock: {
    notificationPreferences: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    notificationPreferences = prismaMock.notificationPreferences;
  }
  return { PrismaClient };
});

import { GET, PUT } from "@/app/api/user/notification-preferences/route";
import { makeRequest, makeUserContext, readJson } from "../_helpers";

describe("/api/user/notification-preferences", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireUserMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET();
      expect(res.status).toBe(401);
    });

    test("returns defaults when no prefs row exists", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
      prismaMock.notificationPreferences.findUnique.mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as { prefs: Record<string, unknown> };
      expect(body.prefs.reminderPush).toBe(true);
    });
  });

  describe("PUT", () => {
    test("returns 401 when unauthenticated", async () => {
      requireUserMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await PUT(
        makeRequest("/api/user/notification-preferences", {
          method: "PUT",
          body: {},
        }),
      );
      expect(res.status).toBe(401);
    });
  });
});
