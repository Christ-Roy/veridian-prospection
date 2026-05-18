/**
 * Tests de GET /api/entreprises/[siren] (fiche détaillée par SIREN).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, prismaMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  prismaMock: {
    entreprise: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth/user-context", () => ({ requireUser: requireUserMock }));
vi.mock("@prisma/client", () => {
  class PrismaClient {
    entreprise = prismaMock.entreprise;
  }
  return { PrismaClient };
});

import { GET } from "@/app/api/entreprises/[siren]/route";
import { makeUserContext, readJson } from "../_helpers";

describe("GET /api/entreprises/[siren]", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireUserMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(new Request("http://x/"), {
      params: Promise.resolve({ siren: "123456789" }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 400 on malformed SIREN (not 9 digits)", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    const res = await GET(new Request("http://x/"), {
      params: Promise.resolve({ siren: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 404 when SIREN not found", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    prismaMock.entreprise.findUnique.mockResolvedValue(null);
    const res = await GET(new Request("http://x/"), {
      params: Promise.resolve({ siren: "999999999" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 200 + serialized entreprise on match", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    prismaMock.entreprise.findUnique.mockResolvedValue({
      siren: "123456789",
      denomination: "ACME",
      chiffreAffaires: BigInt(1000000),
      resultatNet: null,
      montantMarchesPublics: null,
    });
    const res = await GET(new Request("http://x/"), {
      params: Promise.resolve({ siren: "123456789" }),
    });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { siren: string; chiffreAffaires: number };
    expect(body.siren).toBe("123456789");
    expect(body.chiffreAffaires).toBe(1000000);
  });
});
