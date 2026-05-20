/**
 * Tests de la route GET /api/status (état détaillé pour monitoring).
 *
 * Couvre :
 *  - status=healthy quand toutes les checks remontent OK
 *  - status=unhealthy quand DB ko (critical)
 *  - status=degraded quand une dépendance non-critique fail
 *  - shape complet exposé au healthcheck script VPS
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { prismaMock, supabaseMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    user: { count: vi.fn() },
  },
  supabaseMock: {
    from: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => supabaseMock),
}));

import { GET } from "@/app/api/status/route";
import { readJson } from "./_helpers";

describe("GET /api/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  test("returns 200 healthy when DB ping ok and no external deps configured", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1, c: BigInt(0) }]);
    prismaMock.user.count.mockResolvedValue(5);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body.db).toBe("ok");
    expect(body.auth).toBe("ok");
    expect(body.supabase).toBe("not_configured");
    expect(typeof body.uptime_s).toBe("number");
  });

  // Anti-régression : Twenty CRM a été supprimé (refactor 2026-05-20).
  // Si quelqu'un réintroduit checkTwenty() ou le champ `twenty`, ce test
  // casse et oblige à justifier l'ajout au lieu de le laisser passer en silence.
  test("response payload no longer exposes Twenty CRM signal", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1, c: BigInt(0) }]);
    prismaMock.user.count.mockResolvedValue(0);

    const body = (await readJson(await GET())) as Record<string, unknown>;
    expect(body).not.toHaveProperty("twenty");
    expect((body.checks_ms as Record<string, unknown>)).not.toHaveProperty("twenty");
  });

  test("returns 200 unhealthy when DB ping fails (critical)", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("db down"));
    prismaMock.user.count.mockResolvedValue(5);

    const res = await GET();
    // Note: la route renvoie toujours 200 par design (monitoring script lit le body)
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("unhealthy");
    expect(body.db).toBe("fail");
  });

  test("returns 200 degraded when auth check fails (non-critical)", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1, c: BigInt(0) }]);
    prismaMock.user.count.mockRejectedValue(new Error("users table missing"));

    const body = (await readJson(await GET())) as Record<string, unknown>;
    expect(body.status).toBe("degraded");
    expect(body.db).toBe("ok");
    expect(body.auth).toBe("fail");
  });
});
