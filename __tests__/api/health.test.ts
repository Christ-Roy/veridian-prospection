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
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ ok: 1 }]) // SELECT 1
      .mockResolvedValueOnce([{ count: BigInt(42) }]); // COUNT entreprises

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(body.leadCount).toBe(42);
    expect(typeof body.version).toBe("string");
    expect(typeof body.timestamp).toBe("string");
    expect(body.dependencies).toEqual({});
  });

  test("returns 503 + status=down when DB ping fails", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("connection refused"));

    const res = await GET();
    expect(res.status).toBe(503);

    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("down");
    expect(body.db).toBe("ko");
  });

  test("omits leadCount silently when entreprises table missing", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ ok: 1 }])
      .mockRejectedValueOnce(new Error("relation entreprises does not exist"));

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(body.leadCount).toBeUndefined();
  });
});
