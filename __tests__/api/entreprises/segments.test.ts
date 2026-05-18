/**
 * Tests de GET /api/entreprises/segments (catalog list).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, prismaMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  prismaMock: { $queryRaw: vi.fn() },
}));

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    $queryRaw = prismaMock.$queryRaw;
  }
  return { PrismaClient };
});

import { GET } from "@/app/api/entreprises/segments/route";
import { makeUserContext, readJson } from "../_helpers";

describe("GET /api/entreprises/segments", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireUserMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns segments catalog", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    prismaMock.$queryRaw.mockResolvedValue([
      {
        segment_id: "btp-69",
        view_name: "v_btp_69",
        description: "BTP Lyon",
        volume: 1234,
        created_at: new Date(),
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { segments: Array<Record<string, unknown>> };
    expect(body.segments).toHaveLength(1);
    expect(body.segments[0].id).toBe("btp-69");
  });
});
