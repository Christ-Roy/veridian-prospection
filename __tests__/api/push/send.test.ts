/**
 * Tests de POST /api/push/send.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, prismaMock, sendPushNotificationMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  prismaMock: { pushSubscription: { findMany: vi.fn() } },
  sendPushNotificationMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/web-push", () => ({ sendPushNotification: sendPushNotificationMock }));

import { POST } from "@/app/api/push/send/route";
import { makeRequest, makeUserContext } from "../_helpers";

describe("POST /api/push/send", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireUserMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/push/send", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 400 when title/body missing", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    const res = await POST(
      makeRequest("/api/push/send", { method: "POST", body: { title: "Only" } }),
    );
    expect(res.status).toBe(400);
  });

  test("broadcasts to all tenant subscriptions", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext({ tenantId: "t-1" }) });
    prismaMock.pushSubscription.findMany.mockResolvedValue([]);
    const res = await POST(
      makeRequest("/api/push/send", {
        method: "POST",
        body: { title: "Hi", body: "Hello" },
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.pushSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "t-1" } }),
    );
  });
});
