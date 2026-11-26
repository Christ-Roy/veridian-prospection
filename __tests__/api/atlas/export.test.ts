/**
 * GET /api/atlas/export : session obligatoire, plan payant obligatoire (402 sinon), segment de l'espace
 * de la session seulement, 5 000 lignes classées par la priorité, fichier en pièce jointe.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const { ctx, tenant, apercu, lire, filtre, scoring } = vi.hoisted(() => ({
  ctx: vi.fn(),
  tenant: vi.fn(),
  apercu: vi.fn(),
  lire: vi.fn(),
  filtre: vi.fn(async () => ({ conditions: [] })),
  scoring: vi.fn(async () => ({ criteres: [{ champ: "email", op: "renseigne", valeur: true, poids: 3 }] })),
}));
vi.mock("@/lib/auth/user-context", () => ({ getUserContext: ctx }));
const { reserver, ajuster, annuler } = vi.hoisted(() => ({ reserver: vi.fn(), ajuster: vi.fn(async (_n: number) => ({})), annuler: vi.fn(async () => ({})) }));
vi.mock("@/lib/prisma", () => ({ prisma: { tenant: { findUnique: tenant } } }));
vi.mock("@/atlas/extraction", async (orig) => ({ ...(await orig<typeof import("@/atlas/extraction")>()), reserverExport: reserver }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(() => false) }));
vi.mock("@/atlas/source", () => ({ sourceMarche: () => ({ apercu }) }));
vi.mock("@/atlas/segments", async (orig) => ({ ...(await orig<typeof import("@/atlas/segments")>()), lireSegment: lire, filtreEffectif: filtre, scoringCourant: scoring }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/atlas/export/route";
import { RefusExtraction } from "@/atlas/extraction";
import { Introuvable } from "@/atlas/segments";

const ID = "9b2d1c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e";
const req = (q: string) => new NextRequest(`https://prospection.test/api/atlas/export?${q}`);

beforeEach(() => {
  ctx.mockResolvedValue({ userId: "u-1", tenantId: "t-1" });
  tenant.mockResolvedValue({ plan: "pro" });
  lire.mockResolvedValue({ id: ID, nom: "Éleveurs Rhône", colonnes: ["taille"] });
  reserver.mockReset().mockResolvedValue({ taille: 5000, reste: 5000, ajuster, annuler });
  ajuster.mockClear();
  annuler.mockClear();
  apercu.mockResolvedValue({ colonnes: ["siren", "nom", "score"], lignes: [{ siren: "812441145", nom: "A", score: 87 }] });
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("GET /api/atlas/export", () => {
  test("sans session : 401 ; segment ou format invalide : 400", async () => {
    ctx.mockResolvedValueOnce(null);
    expect((await GET(req(`segment_id=${ID}`))).status).toBe(401);
    expect((await GET(req("segment_id=x"))).status).toBe(400);
    expect((await GET(req(`segment_id=${ID}&format=pdf`))).status).toBe(400);
  });

  test("plan gratuit : 402, rien n'est lu", async () => {
    tenant.mockResolvedValueOnce({ plan: "freemium" });
    const r = await GET(req(`segment_id=${ID}`));
    expect(r.status).toBe(402);
    expect(apercu).not.toHaveBeenCalled();
  });

  test("plan payant : xlsx en pièce jointe, classé par la priorité, 5 000 lignes au plus, sur l'espace de la session", async () => {
    apercu.mockClear();
    const r = await GET(req(`segment_id=${ID}&format=xlsx`));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("spreadsheetml");
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="atlas-eleveurs-rhone-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(r.headers.get("x-atlas-lignes")).toBe("1");
    expect(lire).toHaveBeenCalledWith("t-1", ID);
    const [, o] = apercu.mock.calls[0];
    expect(o).toMatchObject({ parPage: 5000, plafond: 5000, scoring: { criteres: expect.any(Array) } });
    expect(o.colonnes.slice(0, 2)).toEqual(["nom", "email"]);
    const corps = Buffer.from(await r.arrayBuffer());
    expect(corps.subarray(0, 2).toString()).toBe("PK");
    expect(reserver).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t-1", userId: "u-1", format: "xlsx", segmentId: ID }), 5000);
    expect(ajuster).toHaveBeenCalledWith(1); // la trace revient aux lignes servies
    expect(r.headers.get("x-atlas-quota-restant")).toBe("4999");
    expect(r.headers.get("x-atlas-coupe-quota")).toBeNull();
  });

  test("un export qui ne peut pas être tracé n'est pas servi, et ODH n'est pas lu", async () => {
    apercu.mockClear();
    reserver.mockRejectedValueOnce(new Error("base muette"));
    expect((await GET(req(`segment_id=${ID}&format=csv`))).status).toBe(500);
    expect(apercu).not.toHaveBeenCalled();
  });

  test("quota du jour épuisé : 429 avec le message, ODH n'est pas lu", async () => {
    apercu.mockClear();
    reserver.mockRejectedValueOnce(new RefusExtraction("Quota du jour atteint"));
    const r = await GET(req(`segment_id=${ID}&format=csv`));
    expect(r.status).toBe(429);
    expect(((await r.json()) as { code: string }).code).toBe("quota_jour");
    expect(apercu).not.toHaveBeenCalled();
  });

  test("reste du jour plus petit que 5 000 : le fichier est coupé à ce reste et le dit", async () => {
    reserver.mockResolvedValueOnce({ taille: 2, reste: 2, ajuster, annuler });
    apercu.mockResolvedValueOnce({ colonnes: ["siren"], lignes: [{ siren: "1" }, { siren: "2" }] });
    const r = await GET(req(`segment_id=${ID}&format=csv`));
    expect(apercu.mock.lastCall?.[1]).toMatchObject({ parPage: 2, plafond: 2 });
    expect(r.headers.get("x-atlas-coupe-quota")).toBe("1");
    expect(r.headers.get("x-atlas-quota-restant")).toBe("0");
    expect(ajuster).not.toHaveBeenCalled();
  });

  test("ODH en échec : la réservation est rendue", async () => {
    apercu.mockRejectedValueOnce(new Error("ClickHouse muet"));
    expect((await GET(req(`segment_id=${ID}&format=csv`))).status).toBe(500);
    expect(annuler).toHaveBeenCalled();
  });

  test("CSV ; segment d'un autre espace : 404", async () => {
    const c = await GET(req(`segment_id=${ID}&format=csv`));
    expect(c.headers.get("content-type")).toContain("text/csv");
    expect([...Buffer.from(await c.arrayBuffer()).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM : Excel lit l'UTF-8
    lire.mockRejectedValueOnce(new Introuvable("segment introuvable"));
    expect((await GET(req(`segment_id=${ID}`))).status).toBe(404);
  });
});
