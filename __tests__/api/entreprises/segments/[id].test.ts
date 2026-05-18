/**
 * Tests de GET /api/entreprises/segments/[id] (paginated segment rows).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, prismaMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  prismaMock: {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    $queryRaw = prismaMock.$queryRaw;
    $queryRawUnsafe = prismaMock.$queryRawUnsafe;
  }
  return { PrismaClient };
});

import { GET } from "@/app/api/entreprises/segments/[id]/route";
import { makeRequest, makeUserContext } from "../../_helpers";

describe("GET /api/entreprises/segments/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireUserMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(makeRequest("/api/entreprises/segments/x"), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 404 when segment not found in catalog", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    prismaMock.$queryRaw.mockResolvedValue([]);
    const res = await GET(makeRequest("/api/entreprises/segments/unknown"), {
      params: Promise.resolve({ id: "unknown" }),
    });
    expect(res.status).toBe(404);
  });
});
