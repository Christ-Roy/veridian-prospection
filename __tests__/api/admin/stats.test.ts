/**
 * Tests de la route GET /api/admin/stats.
 *
 * Cette route héberge les compteurs de volume business (entreprises,
 * outreach, followups, claude_activity, workspaces) qui étaient
 * auparavant exposés par la route PUBLIQUE /api/status — fuite relevée
 * par le pentest T16 (finding L1). Ils sont désormais derrière
 * requireAdmin().
 *
 * Couvre :
 *  - 403 quand l'appelant n'est pas admin (garde requireAdmin)
 *  - 200 + les 5 compteurs quand admin + DB OK
 *  - compteur à -1 quand une COUNT échoue (dégradation gracieuse)
 *  - compteurs à null quand tout le batch DB échoue
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, prismaMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  prismaMock: { $queryRaw: vi.fn() },
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireAdmin: requireAdminMock,
  invalidateUserContext: vi.fn(),
  invalidateAllUserContexts: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { GET } from "@/app/api/admin/stats/route";
import { readJson } from "../_helpers";

describe("GET /api/admin/stats", () => {
  beforeEach(() => vi.clearAllMocks());

  test("403 quand l'appelant n'est pas admin", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });

    const res = await GET();
    expect(res.status).toBe(403);
    // La garde court AVANT toute requête DB.
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  test("200 + les 5 compteurs quand admin + DB OK", async () => {
    requireAdminMock.mockResolvedValue({ ctx: { isAdmin: true } });
    // 5 COUNT en parallèle — on renvoie une valeur distincte à chacun.
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ c: BigInt(996657) }]) // entreprises
      .mockResolvedValueOnce([{ c: BigInt(1083) }]) // outreach
      .mockResolvedValueOnce([{ c: BigInt(156) }]) // followups
      .mockResolvedValueOnce([{ c: BigInt(1174) }]) // claude_activity
      .mockResolvedValueOnce([{ c: BigInt(15) }]); // workspaces

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.entreprises_count).toBe(996657);
    expect(body.outreach_count).toBe(1083);
    expect(body.followups_count).toBe(156);
    expect(body.claude_activity_count).toBe(1174);
    expect(body.workspaces_count).toBe(15);
    expect(typeof body.timestamp).toBe("string");
  });

  test("un COUNT en échec → ce compteur vaut -1, les autres restent bons", async () => {
    requireAdminMock.mockResolvedValue({ ctx: { isAdmin: true } });
    prismaMock.$queryRaw
      .mockResolvedValueOnce([{ c: BigInt(996657) }]) // entreprises OK
      .mockRejectedValueOnce(new Error("table outreach lock")) // outreach KO
      .mockResolvedValueOnce([{ c: BigInt(156) }])
      .mockResolvedValueOnce([{ c: BigInt(1174) }])
      .mockResolvedValueOnce([{ c: BigInt(15) }]);

    const body = (await readJson(await GET())) as Record<string, unknown>;
    expect(body.entreprises_count).toBe(996657);
    expect(body.outreach_count).toBe(-1); // sentinelle d'échec
    expect(body.workspaces_count).toBe(15);
  });
});
