/**
 * Tests de GET /api/entreprises (recherche entreprises pagination).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, prismaMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  prismaMock: {
    entreprise: { findMany: vi.fn(), count: vi.fn() },
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    entreprise = prismaMock.entreprise;
    $queryRaw = prismaMock.$queryRaw;
    $queryRawUnsafe = prismaMock.$queryRawUnsafe;
  }
  return { PrismaClient };
});

import { GET } from "@/app/api/entreprises/route";
import { makeRequest, makeUserContext, readJson } from "./_helpers";

describe("GET /api/entreprises", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when not authenticated", async () => {
    requireUserMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(makeRequest("/api/entreprises"));
    expect(res.status).toBe(401);
  });

  test("returns empty list when no entreprises match", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    prismaMock.entreprise.findMany.mockResolvedValue([]);
    prismaMock.entreprise.count.mockResolvedValue(0);
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    const res = await GET(makeRequest("/api/entreprises?q=test"));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body).toBeTruthy();
  });
});
