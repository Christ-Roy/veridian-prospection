/**
 * Tests de GET /api/stats/today.
 *
 * Pattern fort : assert sur le BODY RETOURNÉ pour détecter tout changement de
 * shape (bug invitations 2026-05-23).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAuthMock, getTenantIdMock, prismaMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  prismaMock: { $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn() },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { GET } from "@/app/api/stats/today/route";
import { readJson } from "../_helpers";

describe("GET /api/stats/today", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("retourne { today: <count> } avec la valeur exacte sortie de la query", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    // prisma.$queryRaw retourne [{ count: bigint }] — la route fait Number(rows[0].count)
    prismaMock.$queryRaw.mockResolvedValue([{ count: BigInt(17) }]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    // Shape canonique strict — si la route change `today` → `count` ou autre,
    // ce test rougit immédiatement.
    expect(body).toEqual({ today: 17 });
  });

  test("retourne { today: 0 } quand aucun outreach visité aujourd'hui", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-2", email: "x@v.site" } });
    getTenantIdMock.mockResolvedValue("t-2");
    prismaMock.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body).toEqual({ today: 0 });
  });
});
