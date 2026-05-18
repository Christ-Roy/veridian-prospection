/**
 * Tests de GET /api/cron/check-reminders.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.CRON_SECRET = "cron-secret-fake";
});

const { prismaMock, sendPushNotificationMock } = vi.hoisted(() => ({
  prismaMock: {
    appointment: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    pushSubscription: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    notificationPreferences: { findMany: vi.fn().mockResolvedValue([]) },
  },
  sendPushNotificationMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/web-push", () => ({
  sendPushNotification: sendPushNotificationMock,
}));

import { GET } from "@/app/api/cron/check-reminders/route";
import { makeRequest } from "../_helpers";

describe("GET /api/cron/check-reminders", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when secret is missing", async () => {
    const res = await GET(makeRequest("/api/cron/check-reminders"));
    expect(res.status).toBe(401);
  });

  test("returns 401 when secret is wrong", async () => {
    const res = await GET(
      makeRequest("/api/cron/check-reminders?secret=wrong"),
    );
    expect(res.status).toBe(401);
  });

  test("returns 200 with empty results when no reminders due", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    const res = await GET(
      makeRequest("/api/cron/check-reminders?secret=cron-secret-fake"),
    );
    expect(res.status).toBe(200);
  });
});
