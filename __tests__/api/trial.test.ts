/**
 * Tests de la route GET /api/trial.
 *
 * Couvre :
 *  - 401 sans auth
 *  - internal mode → daysLeft=TRIAL_DAYS, plan=internal
 *  - Supabase non configuré → fallback plan=unknown
 *  - plan pro → daysLeft=999, isExpired=false
 *  - calcul daysLeft à partir de createdAt utilisateur
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireAuthMock, prismaMock, createClientMock, supabaseMock } = vi.hoisted(() => {
  const sb = {
    from: vi.fn(),
    auth: { admin: { getUserById: vi.fn() } },
  };
  return {
    requireAuthMock: vi.fn(),
    prismaMock: {
      user: { findUnique: vi.fn() },
      workspaceMember: { findFirst: vi.fn() },
    },
    supabaseMock: sb,
    createClientMock: vi.fn(() => sb),
  };
});

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

import { GET } from "@/app/api/trial/route";
import { readJson } from "./_helpers";
import { NextResponse } from "next/server";

describe("GET /api/trial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  test("returns 401 when not authenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns plan=internal for internal user", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "internal", email: "internal@v.site" },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { plan: string; daysLeft: number };
    expect(body.plan).toBe("internal");
    expect(body.daysLeft).toBeGreaterThan(0);
  });

  test("returns plan=unknown when Supabase not configured", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    const res = await GET();
    const body = (await readJson(res)) as { plan: string };
    expect(body.plan).toBe("unknown");
  });

  test("returns daysLeft=999 for paid plan (pro)", async () => {
    process.env.SUPABASE_URL = "https://fake.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    prismaMock.user.findUnique.mockResolvedValue({
      createdAt: new Date("2025-01-01"),
    });
    supabaseMock.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { prospection_plan: "pro" }, error: null }),
    });

    const res = await GET();
    const body = (await readJson(res)) as {
      plan: string;
      daysLeft: number;
      isExpired: boolean;
    };
    expect(body.plan).toBe("pro");
    expect(body.daysLeft).toBe(999);
    expect(body.isExpired).toBe(false);
  });

  test("computes daysLeft from createdAt when no plan override", async () => {
    process.env.SUPABASE_URL = "https://fake.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    process.env.TRIAL_DAYS = "7";
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    // Compte créé il y a 2 jours → daysLeft ~= 5
    prismaMock.user.findUnique.mockResolvedValue({
      createdAt: new Date(Date.now() - 2 * 86400_000),
    });
    supabaseMock.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { prospection_plan: "freemium" }, error: null }),
    });

    const res = await GET();
    const body = (await readJson(res)) as { plan: string; daysLeft: number };
    expect(body.plan).toBe("freemium");
    expect(body.daysLeft).toBeGreaterThanOrEqual(4);
    expect(body.daysLeft).toBeLessThanOrEqual(6);
  });
});
