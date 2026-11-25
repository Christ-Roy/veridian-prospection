/**
 * GET /api/trial : témoin du plan pour la batterie système du Hub (cas 01 « plan lisible », cas 05 « le plan posé
 * au Hub se retrouve dans l'app »). Retirée par erreur avec l'ancienne app le 15/11 : Next servait alors sa page 404
 * en HTML, et le Hub lisait « Unexpected token '<' » (23/11). Toujours du JSON, jamais en cache.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const m = vi.hoisted(() => ({ ctx: vi.fn(), tenant: vi.fn() }));
vi.mock("@/lib/auth/user-context", () => ({ getUserContext: m.ctx }));
vi.mock("@/lib/prisma", () => ({ prisma: { tenant: { findUnique: m.tenant } } }));

import { GET } from "@/app/api/trial/route";
import { GET as INCONNUE } from "@/app/api/[...introuvable]/route";

beforeEach(() => {
  m.ctx.mockReset();
  m.tenant.mockReset();
});

describe("GET /api/trial", () => {
  test("le plan de l'espace, en JSON, sans cache, sans essai qui expire", async () => {
    m.ctx.mockResolvedValue({ userId: "u", tenantId: "t1" });
    m.tenant.mockResolvedValue({ plan: "pro" });
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ plan: "pro", isExpired: false });
    expect(m.tenant).toHaveBeenCalledWith({ where: { id: "t1" }, select: { plan: true } });
  });

  test("plan absent : nul, jamais freemium par défaut ; sans session : 401 en JSON", async () => {
    m.ctx.mockResolvedValue({ userId: "u", tenantId: "t1" });
    m.tenant.mockResolvedValue({ plan: null });
    expect((await (await GET()).json()).plan).toBeNull();
    m.ctx.mockResolvedValue(null);
    const r = await GET();
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Unauthorized" });
  });
});

describe("route d'API inconnue", () => {
  test("404 en JSON, jamais la page HTML de Next", async () => {
    const r = await INCONNUE();
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toMatch(/application\/json/);
    expect(await r.json()).toEqual({ error: "not_found" });
  });
});
