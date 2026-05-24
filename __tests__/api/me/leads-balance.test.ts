/**
 * Tests GET /api/me/leads-balance.
 *
 * Couvre :
 *  - 401 si user non authentifié
 *  - 200 { credited, consumed, balance, plan, refillTier } sur user valide
 *  - balance = credited - consumed (calcul correct)
 *  - balance = 0 si pas de workspace résolu (état dégradé non bloquant)
 *  - tenant.plan mappé correctement vers refillTier
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  tenantFindUnique: vi.fn(),
  workspaceFindUnique: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
    workspace: { findUnique: mocks.workspaceFindUnique },
  },
}));

import { NextResponse } from "next/server";
import { GET } from "@/app/api/me/leads-balance/route";
import { makeUserContext, readJson } from "../_helpers";

const WS_ID = "33333333-3333-4333-8333-333333333333";

function authedUser(activeWs: string | null = WS_ID) {
  return {
    ctx: makeUserContext({
      activeWorkspaceId: activeWs,
      workspaces: activeWs
        ? [
            {
              id: activeWs,
              name: "Default",
              slug: "default",
              role: "owner",
              visibilityScope: "all",
            },
          ]
        : [],
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(authedUser());
  mocks.tenantFindUnique.mockResolvedValue({ plan: "pro" });
  mocks.workspaceFindUnique.mockResolvedValue({
    leadsCredited: 2_500,
    leadsConsumed: 137,
  });
});

describe("GET /api/me/leads-balance", () => {
  test("401 si user non authentifié", async () => {
    mocks.requireUser.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("200 + solde correct", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      credited: number;
      consumed: number;
      balance: number;
      plan: string;
      refillTier: string;
    };
    expect(body.credited).toBe(2_500);
    expect(body.consumed).toBe(137);
    expect(body.balance).toBe(2_363); // 2500 - 137
    expect(body.plan).toBe("pro");
    expect(body.refillTier).toBe("pro");
  });

  test("balance = 0 si pas de workspace résolu (état dégradé)", async () => {
    mocks.requireUser.mockResolvedValue(authedUser(null));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { balance: number; credited: number };
    expect(body.balance).toBe(0);
    expect(body.credited).toBe(0);
  });

  test("refillTier business pour plan=business", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ plan: "business" });
    const res = await GET();
    const body = (await readJson(res)) as { refillTier: string };
    expect(body.refillTier).toBe("business");
  });

  test("refillTier business pour plan=enterprise", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ plan: "enterprise" });
    const res = await GET();
    const body = (await readJson(res)) as { refillTier: string };
    expect(body.refillTier).toBe("business");
  });

  test("refillTier freemium pour plan=null", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ plan: null });
    const res = await GET();
    const body = (await readJson(res)) as { refillTier: string };
    expect(body.refillTier).toBe("freemium");
  });

  test("refillTier freemium si tenant absent (sécurité fail-safe)", async () => {
    mocks.tenantFindUnique.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { refillTier: string; plan: string };
    expect(body.refillTier).toBe("freemium");
    expect(body.plan).toBe("freemium");
  });
});
