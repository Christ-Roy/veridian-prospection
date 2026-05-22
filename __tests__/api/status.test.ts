/**
 * Tests de la route GET /api/status (état détaillé pour monitoring).
 *
 * Couvre :
 *  - status=healthy quand toutes les checks remontent OK
 *  - status=unhealthy quand DB ko (critical)
 *  - status=degraded quand auth Prisma fail (non-critical)
 *  - shape complet exposé au healthcheck script VPS
 *  - anti-régression Twenty + Supabase (champs supprimés du payload)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    user: { count: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { GET } from "@/app/api/status/route";
import { readJson } from "./_helpers";

describe("GET /api/status", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 200 healthy when DB ping ok + auth Prisma ok", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1, c: BigInt(0) }]);
    prismaMock.user.count.mockResolvedValue(5);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body.db).toBe("ok");
    expect(body.auth).toBe("ok");
    expect(typeof body.uptime_s).toBe("number");
  });

  test("returns 503 unhealthy when DB ping fails (critical)", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("db down"));
    prismaMock.user.count.mockResolvedValue(5);

    const res = await GET();
    expect(res.status).toBe(503);
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

  // ── Anti-régression : champs supprimés du payload ─────────────────────
  // Si quelqu'un ré-introduit checkTwenty/checkSupabase ou les champs
  // associés, ces tests cassent et obligent à justifier l'ajout au lieu
  // de le laisser passer en silence.
  test("response payload no longer exposes Twenty CRM signal", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1, c: BigInt(0) }]);
    prismaMock.user.count.mockResolvedValue(0);

    const body = (await readJson(await GET())) as Record<string, unknown>;
    expect(body).not.toHaveProperty("twenty");
    expect((body.checks_ms as Record<string, unknown>)).not.toHaveProperty("twenty");
  });

  test("response payload no longer exposes Supabase signal (refactor 2026-05-20)", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1, c: BigInt(0) }]);
    prismaMock.user.count.mockResolvedValue(0);

    const body = (await readJson(await GET())) as Record<string, unknown>;
    expect(body).not.toHaveProperty("supabase");
    expect((body.checks_ms as Record<string, unknown>)).not.toHaveProperty("supabase");
  });

  // ── Sécurité : pas de fuite de volumes business (pentest T16 L1) ───────
  // /api/status est PUBLIC. Les compteurs (entreprises, outreach, etc.)
  // divulguent la taille du business — ils ont été déplacés vers
  // /api/admin/stats (authed). Si quelqu'un les ré-ajoute ici, ça casse.
  test("ne fuite AUCUN compteur business (route publique)", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    prismaMock.user.count.mockResolvedValue(0);

    const body = (await readJson(await GET())) as Record<string, unknown>;
    expect(body).not.toHaveProperty("entreprises_count");
    expect(body).not.toHaveProperty("outreach_count");
    expect(body).not.toHaveProperty("followups_count");
    expect(body).not.toHaveProperty("claude_activity_count");
    expect(body).not.toHaveProperty("workspaces_count");
  });
});
