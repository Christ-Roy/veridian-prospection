/**
 * Tests de GET /api/leads/[domain]/history (INPI history).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAuthMock, prismaMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  prismaMock: { $queryRawUnsafe: vi.fn() },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { GET } from "@/app/api/leads/[domain]/history/route";
import { makeRequest, readJson } from "../../_helpers";

describe("GET /api/leads/[domain]/history", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(makeRequest("/api/leads/123/history"), {
      params: Promise.resolve({ domain: "123" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 400 on invalid SIREN", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    const res = await GET(makeRequest("/api/leads/abc/history"), {
      params: Promise.resolve({ domain: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns INPI history rows", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      { annee: 2024, ca_net: 1000000, resultat_net: 50000 },
    ]);
    const res = await GET(makeRequest("/api/leads/123456789/history"), {
      params: Promise.resolve({ domain: "123456789" }),
    });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as unknown;
    expect(body).toBeTruthy();
  });
});
