/**
 * Tests de la route GET /api/health.
 *
 * Couvre :
 *  - statut 200 + db="ok" quand Prisma répond
 *  - statut 503 + db="ko" quand Prisma timeout/throw
 *  - shape conforme au standard Veridian SaaS (docs/saas-standards.md §8)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

import { GET } from "@/app/api/health/route";
import { readJson } from "./_helpers";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 200 + status=ok when DB ping succeeds", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ ok: 1 }]); // SELECT 1

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    // L'ancienne table « entreprises » n'est plus lue (Atlas sur ODH) : une seule requête, aucun leadCount.
    expect(body.leadCount).toBeUndefined();
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(typeof body.version).toBe("string");
    expect(typeof body.timestamp).toBe("string");
    // Sans CLICKHOUSE_PASSWORD (tests), Atlas tourne sur la source simulée : ClickHouse « skipped ».
    expect(body.dependencies).toEqual({ clickhouse: "skipped" });
  });

  test("returns 503 + status=down when DB ping fails", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("connection refused"));

    const res = await GET();
    expect(res.status).toBe(503);

    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("down");
    expect(body.db).toBe("ko");
  });
});
