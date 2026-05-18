/**
 * Tests des routes /api/appointments/[id] (PATCH, DELETE).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, prismaMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  prismaMock: {
    appointment: {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    appointment = prismaMock.appointment;
  }
  return { PrismaClient };
});

import { PATCH, DELETE } from "@/app/api/appointments/[id]/route";
import { makeRequest, makeUserContext } from "../_helpers";

const params = { params: Promise.resolve({ id: "appt-1" }) };

describe("/api/appointments/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("PATCH", () => {
    test("returns 401 when unauthenticated", async () => {
      requireUserMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await PATCH(
        makeRequest("/api/appointments/appt-1", { method: "PATCH", body: {} }),
        params,
      );
      expect(res.status).toBe(401);
    });

    test("returns 404 when appointment not in tenant", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext({ tenantId: "t-1" }) });
      prismaMock.appointment.findFirst.mockResolvedValue(null);
      const res = await PATCH(
        makeRequest("/api/appointments/appt-1", {
          method: "PATCH",
          body: { title: "New" },
        }),
        params,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE", () => {
    test("returns 401 when unauthenticated", async () => {
      requireUserMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await DELETE(
        makeRequest("/api/appointments/appt-1", { method: "DELETE" }),
        params,
      );
      expect(res.status).toBe(401);
    });

    test("returns 404 when appointment not in tenant", async () => {
      requireUserMock.mockResolvedValue({ ctx: makeUserContext({ tenantId: "t-1" }) });
      prismaMock.appointment.findFirst.mockResolvedValue(null);
      const res = await DELETE(
        makeRequest("/api/appointments/appt-1", { method: "DELETE" }),
        params,
      );
      expect(res.status).toBe(404);
    });
  });
});
