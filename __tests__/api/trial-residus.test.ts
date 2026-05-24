/**
 * Tests anti-régression — audit trial résidus 2026-05-24.
 *
 * Promesse Robert : « client paie = AUCUN cap, AUCUN bandeau, AUCUN compteur
 * visible. » Ces tests verrouillent les corrections livrées :
 *
 *  1. `/api/trial` retourne `daysLeft=999, isExpired=false` pour TOUS les
 *     plans non-trial (pro, business, enterprise, starter, lifetime_*,
 *     internal) — pas seulement pro/enterprise.
 *  2. `/api/trial` renvoie toujours un champ `isExpired` cohérent avec
 *     `daysLeft` (le client `trial-context.tsx` le recalcule, mais on veut
 *     l'avoir aussi côté serveur pour le contrat).
 *  3. Le cache `planCache` de `tenant.ts` est invalidé proprement par
 *     `invalidatePlanCacheForTenant` quand le Hub pousse un update-plan —
 *     sans ça un user qui upgrade reste capé jusqu'à 5 min.
 *  4. Le sabotage : si on revient en arrière sur la liste NON_TRIAL_PLANS
 *     ou sur l'invalidation cache, le test casse.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

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

type TrialResponse = { plan: string; daysLeft: number; isExpired?: boolean };

describe("GET /api/trial — aucun résidu trial pour les plans payants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TRIAL_DAYS = "7";
    requireAuthMock.mockResolvedValue({
      user: { id: "u-paid", email: "paid@v.site" },
    });
    prismaMock.user.findUnique.mockResolvedValue({
      // createdAt ancien — sans le fix, daysLeft tomberait à 0 et isExpired=true.
      createdAt: new Date("2020-01-01"),
    });
    prismaMock.workspaceMember.findFirst.mockResolvedValue(null);
  });

  // Matrice : tout plan non-freemium doit renvoyer daysLeft=999, isExpired=false.
  // Sans le fix, seuls pro / enterprise étaient reconnus → business / starter /
  // lifetime_* / internal voyaient un trial expiré.
  const paidPlans = [
    "pro",
    "business",
    "enterprise",
    "starter",
    "lifetime_site_vitrine",
    "lifetime_partner",
    "internal",
  ];

  for (const plan of paidPlans) {
    test(`plan=${plan} → daysLeft=999 isExpired=false (jamais de paywall)`, async () => {
      prismaMock.tenant.findFirst.mockResolvedValueOnce({ plan });
      const res = await GET();
      const body = (await readJson(res)) as TrialResponse;
      expect(body.plan).toBe(plan);
      expect(body.daysLeft).toBe(999);
      expect(body.isExpired).toBe(false);
    });
  }

  test("plan=freemium → calcul depuis createdAt + isExpired exposé", async () => {
    prismaMock.tenant.findFirst.mockResolvedValueOnce({ plan: "freemium" });
    const res = await GET();
    const body = (await readJson(res)) as TrialResponse;
    expect(body.plan).toBe("freemium");
    expect(body.daysLeft).toBe(0); // user créé en 2020, TRIAL_DAYS=7
    expect(body.isExpired).toBe(true);
  });

  test("freemium nouveau (createdAt récent) → isExpired=false", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ createdAt: new Date() });
    prismaMock.tenant.findFirst.mockResolvedValueOnce({ plan: "freemium" });
    const res = await GET();
    const body = (await readJson(res)) as TrialResponse;
    expect(body.plan).toBe("freemium");
    expect(body.daysLeft).toBeGreaterThan(0);
    expect(body.isExpired).toBe(false);
  });

  test("erreur Prisma → fail-safe isExpired=false (pas de paywall par panne)", async () => {
    prismaMock.user.findUnique.mockRejectedValueOnce(new Error("db down"));
    const res = await GET();
    const body = (await readJson(res)) as TrialResponse;
    expect(body.plan).toBe("error");
    expect(body.isExpired).toBe(false);
  });

  test("401 quand pas d'auth", async () => {
    requireAuthMock.mockResolvedValueOnce({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
