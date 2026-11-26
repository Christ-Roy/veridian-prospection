/**
 * POST /api/atlas/[outil] : l'interface appelle les outils Atlas avec la session, mêmes droits que l'IA.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

vi.hoisted(() => {
  process.env.ATLAS_SIMULE = "1";
});
const { getCtx } = vi.hoisted(() => ({ getCtx: vi.fn() }));
vi.mock("@/lib/auth/user-context", () => ({ getUserContext: getCtx, resolveInsertWorkspaceId: vi.fn(async () => "w") }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(() => false) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { POST } from "@/app/api/atlas/[outil]/route";

const ctx = (role: "member" | "viewer") => ({
  userId: "u-1", email: "a@b.fr", tenantId: "t-1", tenantOwnerId: "u-0", isAdmin: false, activeWorkspaceId: "w",
  workspaces: [{ id: "w", name: "W", slug: "w", role, visibilityScope: "all" }],
});
const appel = (outil: string, corps: unknown, entetes: Record<string, string> = { "content-type": "application/json" }) =>
  POST(new NextRequest(`https://p.test/api/atlas/${outil}`, { method: "POST", body: JSON.stringify(corps), headers: entetes }), { params: Promise.resolve({ outil }) });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/atlas/[outil]", () => {
  test("sans session : 401", async () => {
    getCtx.mockResolvedValue(null);
    expect((await appel("explorer_marche", { filtre: {} })).status).toBe(401);
  });

  test("explorer le marché : résultat de l'outil, données simulées signalées", async () => {
    getCtx.mockResolvedValue(ctx("member"));
    const r = await appel("explorer_marche", { filtre: { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }] }, par_page: 2 });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.donnees_simulees).toBe(true);
    expect(b.lignes).toHaveLength(2);
  });

  test("filtre invalide : 400 avec le message lisible", async () => {
    getCtx.mockResolvedValue(ctx("member"));
    const r = await appel("explorer_marche", { filtre: { conditions: [{ champ: "mot_de_passe", op: "egal", valeur: "x" }] } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/champ inconnu/);
  });

  test("un lecteur ne peut pas écrire, et un outil hors Atlas n'existe pas ici", async () => {
    getCtx.mockResolvedValue(ctx("viewer"));
    expect((await appel("creer_segment", { nom: "x", filtre: {} })).status).toBe(404);
    getCtx.mockResolvedValue(ctx("member"));
    expect((await appel("changer_statut", { siren: "123456789", statut: "interesse" })).status).toBe(404);
  });

  test("un autre site ne déclenche pas d'outil par la session (403), ni un corps qui n'est pas du JSON", async () => {
    getCtx.mockResolvedValue(ctx("member"));
    expect((await appel("explorer_marche", { filtre: {} }, { "content-type": "application/json", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await appel("explorer_marche", { filtre: {} }, { "content-type": "text/plain" })).status).toBe(403);
    expect(getCtx).not.toHaveBeenCalled();
  });

  test("espace en lecture seule : écriture 402, lecture servie", async () => {
    getCtx.mockResolvedValue({ ...ctx("member"), lectureSeule: "workspace_suspended" });
    const r = await appel("creer_segment", { nom: "x", filtre: {} });
    expect(r.status).toBe(402);
    expect((await r.json()).error).toBe("workspace_suspended");
    expect((await appel("explorer_marche", { filtre: {}, par_page: 1 })).status).toBe(200);
  });
});
