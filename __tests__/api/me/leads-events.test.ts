/**
 * Tests GET /api/me/leads-events.
 *
 * Couvre :
 *  - 401 si user non authentifié
 *  - 200 { events: [], total: 0 } si pas de workspace résolu
 *  - 200 + events triés desc par createdAt
 *  - limit param clampé (max 100, default 50)
 *  - format ISO sur createdAt
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  leadCreditEventFindMany: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    leadCreditEvent: { findMany: mocks.leadCreditEventFindMany },
  },
}));

import { NextResponse } from "next/server";
import { GET } from "@/app/api/me/leads-events/route";
import { makeRequest, makeUserContext, readJson } from "../_helpers";

const WS_ID = "44444444-4444-4444-8444-444444444444";

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

function getReq(searchParams: Record<string, string> = {}) {
  return makeRequest("/api/me/leads-events", {
    method: "GET",
    searchParams,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(authedUser());
  mocks.leadCreditEventFindMany.mockResolvedValue([
    {
      id: "evt-1",
      quantity: 500,
      source: "purchase",
      welcomePlan: null,
      stripePaymentId: "cs_test_1",
      createdAt: new Date("2026-05-22T10:00:00Z"),
    },
    {
      id: "evt-2",
      quantity: 2000,
      source: "welcome",
      welcomePlan: "pro",
      stripePaymentId: null,
      createdAt: new Date("2026-05-15T08:00:00Z"),
    },
  ]);
});

describe("GET /api/me/leads-events", () => {
  test("401 si user non authentifié", async () => {
    mocks.requireUser.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  test("200 + events si workspace présent", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      events: Array<{
        id: string;
        quantity: number;
        source: string;
        createdAt: string;
      }>;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].id).toBe("evt-1");
    expect(body.events[0].source).toBe("purchase");
    // ISO format check
    expect(body.events[0].createdAt).toBe("2026-05-22T10:00:00.000Z");
  });

  test("200 + events vides si pas de workspace (état dégradé)", async () => {
    mocks.requireUser.mockResolvedValue(authedUser(null));
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { events: unknown[]; total: number };
    expect(body.events).toEqual([]);
    expect(body.total).toBe(0);
    // Prisma jamais appelé sans workspace.
    expect(mocks.leadCreditEventFindMany).not.toHaveBeenCalled();
  });

  test("limit param appliqué (clampé à 100 max)", async () => {
    await GET(getReq({ limit: "500" }));
    expect(mocks.leadCreditEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  test("limit param default 50 si absent", async () => {
    await GET(getReq());
    expect(mocks.leadCreditEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  test("limit param ignoré si négatif ou non-numérique", async () => {
    await GET(getReq({ limit: "abc" }));
    expect(mocks.leadCreditEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
    mocks.leadCreditEventFindMany.mockClear();
    await GET(getReq({ limit: "-10" }));
    expect(mocks.leadCreditEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  test("findMany scoped au workspaceId courant + orderBy desc", async () => {
    await GET(getReq());
    const call = mocks.leadCreditEventFindMany.mock.calls[0][0];
    expect(call.where).toEqual({ workspaceId: WS_ID });
    expect(call.orderBy).toEqual({ createdAt: "desc" });
  });
});
