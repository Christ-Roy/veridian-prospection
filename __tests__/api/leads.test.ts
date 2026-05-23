/**
 * Tests de GET /api/leads (liste paginée).
 *
 * Pattern fort : assert sur le BODY RETOURNÉ (shape exact), pas juste sur le
 * mock appelé. Détecte les refactors qui changent le shape de la response
 * (bug invitations 2026-05-23).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getTenantProspectLimitMock,
  queriesMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getTenantProspectLimitMock: vi.fn(),
  queriesMock: { getLeads: vi.fn() },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({
  getTenantId: getTenantIdMock,
  getTenantProspectLimit: getTenantProspectLimitMock,
}));
vi.mock("@/lib/queries", () => queriesMock);

import { GET } from "@/app/api/leads/route";
import { makeRequest, readJson } from "./_helpers";

describe("GET /api/leads", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(makeRequest("/api/leads"));
    expect(res.status).toBe(401);
  });

  test("returns leads paginated avec shape canonique {data, total, totalPages, prospectLimit, limitReached}", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getTenantProspectLimitMock.mockResolvedValue(100000);
    queriesMock.getLeads.mockResolvedValue({
      data: [
        { siren: "111111111", denomination: "ACME" },
        { siren: "222222222", denomination: "BETA" },
      ],
      total: 42,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
    const res = await GET(makeRequest("/api/leads?page=1&pageSize=50"));
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as Record<string, unknown>;
    // Shape canonique : data + total + totalPages + prospectLimit + limitReached.
    expect(body).toMatchObject({
      data: [
        { siren: "111111111", denomination: "ACME" },
        { siren: "222222222", denomination: "BETA" },
      ],
      total: 42,
      prospectLimit: 100000,
      limitReached: false,
    });
    expect(body.totalPages).toBeGreaterThanOrEqual(1);
  });

  test("applique le cap freemium prospectLimit=300 et marque limitReached=true", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-2", email: "x@v.site" } });
    getTenantIdMock.mockResolvedValue("t-2");
    getTenantProspectLimitMock.mockResolvedValue(300);
    queriesMock.getLeads.mockResolvedValue({
      data: [{ siren: "333333333", denomination: "CARROT" }],
      total: 5000, // total > prospectLimit → cappé à 300, limitReached:true
      page: 1,
      pageSize: 50,
      totalPages: 100,
    });
    const res = await GET(makeRequest("/api/leads?page=1&pageSize=50"));
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as {
      data: unknown[];
      total: number;
      totalPages: number;
      prospectLimit: number;
      limitReached: boolean;
    };
    expect(body.total).toBe(300); // cappé
    expect(body.prospectLimit).toBe(300);
    expect(body.limitReached).toBe(true);
    expect(body.totalPages).toBe(Math.ceil(300 / 50)); // 6
  });

  test("retourne data=[] quand la page demandée dépasse le quota freemium", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-3", email: "y@v.site" } });
    getTenantIdMock.mockResolvedValue("t-3");
    getTenantProspectLimitMock.mockResolvedValue(300);
    queriesMock.getLeads.mockResolvedValue({
      data: [{ siren: "999999999", denomination: "OVER" }],
      total: 5000,
      page: 10,
      pageSize: 50,
      totalPages: 100,
    });
    // page=10 * pageSize=50 = offset 450 > 300 → data vide
    const res = await GET(makeRequest("/api/leads?page=10&pageSize=50"));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { data: unknown[]; limitReached: boolean };
    expect(body.data).toEqual([]);
    expect(body.limitReached).toBe(true);
  });
});
