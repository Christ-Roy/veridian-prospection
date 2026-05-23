/**
 * Tests de la route GET /api/admin/client-errors.
 *
 * Endpoint d'agrégation des erreurs JS clientes persistées par /api/errors
 * (cf ticket 2026-05-23-persist-client-errors-db.md).
 *
 * Contrat :
 *   - 403 si l'appelant n'est pas admin (gate requireAdmin)
 *   - groupBy dedupeKey, ordonné par _sum.count DESC
 *   - Sample row (lastSeenAt DESC) attaché par groupe → message/stack/url
 *   - Parsing "since" : "7d" / "12h" / "30m" / ISO / défaut 7j
 *   - limit clampé à [1, 100]
 *   - findMany skippé si table vide
 *
 * Run: npx vitest run __tests__/api/admin/client-errors.test.ts
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, prismaMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  prismaMock: {
    clientError: { groupBy: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireAdmin: requireAdminMock,
  invalidateUserContext: vi.fn(),
  invalidateAllUserContexts: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { GET } from "@/app/api/admin/client-errors/route";
import { makeRequest, readJson } from "../_helpers";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({
    ctx: { userId: "u-1", tenantId: "t-1", isAdmin: true },
  });
});

describe("GET /api/admin/client-errors — auth gate", () => {
  test("403 quand non admin", async () => {
    requireAdminMock.mockResolvedValueOnce({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await GET(makeRequest("/api/admin/client-errors"));
    expect(res.status).toBe(403);
    expect(prismaMock.clientError.groupBy).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/client-errors — happy path", () => {
  test("aggrège + attache sample par dedupeKey, ordonné DESC", async () => {
    prismaMock.clientError.groupBy.mockResolvedValueOnce([
      {
        dedupeKey: "k1",
        _sum: { count: 42 },
        _min: { occurredAt: new Date("2026-05-22T10:00:00Z"), message: "TypeError A" },
        _max: { lastSeenAt: new Date("2026-05-23T08:00:00Z") },
      },
      {
        dedupeKey: "k2",
        _sum: { count: 7 },
        _min: { occurredAt: new Date("2026-05-23T01:00:00Z"), message: "RangeError B" },
        _max: { lastSeenAt: new Date("2026-05-23T02:00:00Z") },
      },
    ]);
    prismaMock.clientError.findMany.mockResolvedValueOnce([
      { dedupeKey: "k1", message: "TypeError A latest", stack: "stk1", url: "https://x/a" },
      { dedupeKey: "k1", message: "TypeError A older", stack: "stkold", url: "https://x/a" },
      { dedupeKey: "k2", message: "RangeError B", stack: "stk2", url: "https://x/b" },
    ]);

    const res = await GET(makeRequest("/api/admin/client-errors"));
    expect(res.status).toBe(200);
    const json = (await readJson(res)) as {
      totalGroups: number;
      groups: Array<{
        dedupeKey: string;
        totalCount: number;
        message: string;
        url: string | null;
        stack: string | null;
      }>;
    };
    expect(json.totalGroups).toBe(2);
    expect(json.groups[0].dedupeKey).toBe("k1");
    expect(json.groups[0].totalCount).toBe(42);
    // Sample = lastSeen first (findMany order DESC), pas _min
    expect(json.groups[0].message).toBe("TypeError A latest");
    expect(json.groups[0].stack).toBe("stk1");
    expect(json.groups[1].dedupeKey).toBe("k2");
    expect(json.groups[1].totalCount).toBe(7);

    expect(prismaMock.clientError.groupBy.mock.calls[0]![0]!.orderBy).toEqual({
      _sum: { count: "desc" },
    });
  });

  test("table vide → totalGroups 0, findMany pas appelé", async () => {
    prismaMock.clientError.groupBy.mockResolvedValueOnce([]);
    const res = await GET(makeRequest("/api/admin/client-errors"));
    const json = (await readJson(res)) as { totalGroups: number; groups: unknown[] };
    expect(json.totalGroups).toBe(0);
    expect(json.groups).toEqual([]);
    expect(prismaMock.clientError.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/client-errors — parsing since", () => {
  test("défaut = 7 jours", async () => {
    prismaMock.clientError.groupBy.mockResolvedValueOnce([]);
    const before = Date.now();
    await GET(makeRequest("/api/admin/client-errors"));
    const since: Date = prismaMock.clientError.groupBy.mock.calls[0]![0]!.where.occurredAt.gte;
    const diff = before - since.getTime();
    expect(diff).toBeGreaterThanOrEqual(7 * 86_400_000 - 5000);
    expect(diff).toBeLessThanOrEqual(7 * 86_400_000 + 5000);
  });

  test("parse '12h'", async () => {
    prismaMock.clientError.groupBy.mockResolvedValueOnce([]);
    const before = Date.now();
    await GET(makeRequest("/api/admin/client-errors?since=12h"));
    const since: Date = prismaMock.clientError.groupBy.mock.calls[0]![0]!.where.occurredAt.gte;
    const diff = before - since.getTime();
    expect(diff).toBeGreaterThanOrEqual(12 * 3_600_000 - 5000);
    expect(diff).toBeLessThanOrEqual(12 * 3_600_000 + 5000);
  });

  test("parse '30m'", async () => {
    prismaMock.clientError.groupBy.mockResolvedValueOnce([]);
    const before = Date.now();
    await GET(makeRequest("/api/admin/client-errors?since=30m"));
    const since: Date = prismaMock.clientError.groupBy.mock.calls[0]![0]!.where.occurredAt.gte;
    const diff = before - since.getTime();
    expect(diff).toBeGreaterThanOrEqual(30 * 60_000 - 5000);
    expect(diff).toBeLessThanOrEqual(30 * 60_000 + 5000);
  });

  test("parse ISO 8601", async () => {
    prismaMock.clientError.groupBy.mockResolvedValueOnce([]);
    await GET(makeRequest("/api/admin/client-errors?since=2026-05-20T00:00:00Z"));
    const since: Date = prismaMock.clientError.groupBy.mock.calls[0]![0]!.where.occurredAt.gte;
    expect(since.toISOString()).toBe("2026-05-20T00:00:00.000Z");
  });
});

describe("GET /api/admin/client-errors — limit clamp", () => {
  test("clamp à 100 max", async () => {
    prismaMock.clientError.groupBy.mockResolvedValueOnce([]);
    await GET(makeRequest("/api/admin/client-errors?limit=500"));
    expect(prismaMock.clientError.groupBy.mock.calls[0]![0]!.take).toBe(100);
  });

  test("clamp à 1 min (limit=0)", async () => {
    prismaMock.clientError.groupBy.mockResolvedValueOnce([]);
    await GET(makeRequest("/api/admin/client-errors?limit=0"));
    expect(prismaMock.clientError.groupBy.mock.calls[0]![0]!.take).toBe(1);
  });

  test("défaut = 50", async () => {
    prismaMock.clientError.groupBy.mockResolvedValueOnce([]);
    await GET(makeRequest("/api/admin/client-errors"));
    expect(prismaMock.clientError.groupBy.mock.calls[0]![0]!.take).toBe(50);
  });
});
