/**
 * Tests des routes /api/appointments (GET, POST).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, prismaMock, buildGoogleCalendarUrlMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  prismaMock: {
    appointment: { findMany: vi.fn(), create: vi.fn() },
  },
  buildGoogleCalendarUrlMock: vi.fn(() => "https://calendar.google.com/calendar/r/eventedit?..."),
}));

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/google-calendar", () => ({
  buildGoogleCalendarUrl: buildGoogleCalendarUrlMock,
}));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    appointment = prismaMock.appointment;
  }
  return { PrismaClient };
});

import { GET, POST } from "@/app/api/appointments/route";
import { makeRequest, makeUserContext } from "./_helpers";

describe("/api/appointments", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireUserMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET(makeRequest("/api/appointments"));
      expect(res.status).toBe(401);
    });

    test("returns appointments scoped to tenant", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext({ tenantId: "t-1" }) });
      prismaMock.appointment.findMany.mockResolvedValue([]);
      const res = await GET(makeRequest("/api/appointments?siren=123456789"));
      expect(res.status).toBe(200);
      expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: "t-1", siren: "123456789" }),
        }),
      );
    });
  });

  describe("POST", () => {
    test("returns 401 when unauthenticated", async () => {
      requireUserMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await POST(makeRequest("/api/appointments", { method: "POST", body: {} }));
      expect(res.status).toBe(401);
    });

    test("returns 400 when required fields missing", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
      const res = await POST(
        makeRequest("/api/appointments", {
          method: "POST",
          body: { siren: "123456789" },
        }),
      );
      expect(res.status).toBe(400);
    });

    test("returns 400 on invalid date", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
      const res = await POST(
        makeRequest("/api/appointments", {
          method: "POST",
          body: { siren: "123456789", startAt: "not-a-date", title: "Demo" },
        }),
      );
      expect(res.status).toBe(400);
    });
  });
});
