/**
 * Tests de POST /api/push/subscribe.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, prismaMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  prismaMock: { pushSubscription: { upsert: vi.fn() } },
}));

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { POST } from "@/app/api/push/subscribe/route";
import { makeRequest, makeUserContext } from "../_helpers";

describe("POST /api/push/subscribe", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireUserMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/push/subscribe", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 400 on missing fields", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    const res = await POST(
      makeRequest("/api/push/subscribe", {
        method: "POST",
        body: { endpoint: "https://push.example.com/x" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("upserts subscription on valid payload", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    prismaMock.pushSubscription.upsert.mockResolvedValue({});
    const res = await POST(
      makeRequest("/api/push/subscribe", {
        method: "POST",
        body: {
          endpoint: "https://push.example.com/x",
          keys: { p256dh: "p256", auth: "auth" },
          platform: "web",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.pushSubscription.upsert).toHaveBeenCalled();
  });
});
