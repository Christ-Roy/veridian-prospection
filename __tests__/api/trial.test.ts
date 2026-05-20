/**
 * Tests de la route GET /api/trial.
 *
 * Couvre :
 *  - 401 sans auth
 *  - 200 plan=freemium si pas de tenant trouvé (fallback)
 *  - 200 plan=pro / enterprise → daysLeft=999, isExpired=false
 *  - 200 lookup tenant via owner (userId direct)
 *  - 200 lookup tenant via membre invité (workspace_members)
 *  - 200 calcul daysLeft depuis createdAt user (TRIAL_DAYS=7)
 *  - 200 plan=error en cas d'exception Prisma (degradation gracieuse)
 *
 * Anti-régression : aucune dépendance Supabase (refactor 2026-05-20).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { requireAuthMock, prismaMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn() },
    tenant: { findFirst: vi.fn() },
    workspaceMember: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { GET } from "@/app/api/trial/route";
import { readJson } from "./_helpers";
import { NextResponse } from "next/server";

describe("GET /api/trial — Prisma-only après refactor 2026-05-20", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TRIAL_DAYS = "7";
  });

  test("returns 401 when not authenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("returns plan=freemium quand aucun tenant trouvé (ni owner ni membre)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: new Date() });
    prismaMock.tenant.findFirst.mockResolvedValue(null);
    prismaMock.workspaceMember.findFirst.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { plan: string; daysLeft: number };
    expect(body.plan).toBe("freemium");
    expect(body.daysLeft).toBe(7);
  });

  test("returns daysLeft=999 pour plan pro (owner direct)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    prismaMock.user.findUnique.mockResolvedValue({
      createdAt: new Date("2025-01-01"),
    });
    prismaMock.tenant.findFirst.mockResolvedValueOnce({ plan: "pro" });

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

  test("returns daysLeft=999 pour plan enterprise (owner direct)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: new Date() });
    prismaMock.tenant.findFirst.mockResolvedValueOnce({ plan: "enterprise" });

    const body = (await readJson(await GET())) as { plan: string; daysLeft: number };
    expect(body.plan).toBe("enterprise");
    expect(body.daysLeft).toBe(999);
  });

  test("fallback workspace_members quand user n'est pas owner direct", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-invited", email: "guest@v.site" } });
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: new Date() });
    // 1er findFirst (owner direct) → null, 2e (via workspace) → tenant trouvé
    prismaMock.tenant.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ plan: "pro" });
    prismaMock.workspaceMember.findFirst.mockResolvedValue({
      workspace: { tenantId: "t-1" },
    });

    const res = await GET();
    const body = (await readJson(res)) as { plan: string; daysLeft: number };
    expect(body.plan).toBe("pro");
    expect(body.daysLeft).toBe(999);
    // Vérifie qu'on a bien lookup le tenant via membership
    expect(prismaMock.workspaceMember.findFirst).toHaveBeenCalled();
  });

  test("calcule daysLeft depuis createdAt quand plan freemium", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    // Compte créé il y a 2 jours → daysLeft ~= 5
    prismaMock.user.findUnique.mockResolvedValue({
      createdAt: new Date(Date.now() - 2 * 86400_000),
    });
    prismaMock.tenant.findFirst.mockResolvedValueOnce({ plan: "freemium" });

    const body = (await readJson(await GET())) as { plan: string; daysLeft: number };
    expect(body.plan).toBe("freemium");
    expect(body.daysLeft).toBeGreaterThanOrEqual(4);
    expect(body.daysLeft).toBeLessThanOrEqual(6);
  });

  test("daysLeft=0 si trial expiré (compte créé il y a 30j)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    prismaMock.user.findUnique.mockResolvedValue({
      createdAt: new Date(Date.now() - 30 * 86400_000),
    });
    prismaMock.tenant.findFirst.mockResolvedValueOnce({ plan: "freemium" });

    const body = (await readJson(await GET())) as { daysLeft: number };
    expect(body.daysLeft).toBe(0);
  });

  test("plan=error en cas d'exception Prisma (degradation gracieuse)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    prismaMock.user.findUnique.mockRejectedValue(new Error("db down"));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { plan: string; daysLeft: number };
    expect(body.plan).toBe("error");
    expect(body.daysLeft).toBe(7);
  });

  // Anti-régression : la route ne doit JAMAIS appeler @supabase/supabase-js
  // (refactor 2026-05-20). Le module est désinstallé, l'import casserait.
  test("source de la route ne contient plus d'import supabase", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(process.cwd(), "src/app/api/trial/route.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/@supabase\/supabase-js/);
    expect(source).not.toMatch(/SUPABASE_URL/);
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
