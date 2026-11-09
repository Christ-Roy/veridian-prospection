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
vi.mock("@/lib/prisma", () => ({ prisma: { tenant: { findUnique: tenant } } }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn(() => false) }));
vi.mock("@/atlas/source", () => ({ sourceMarche: () => ({ apercu }) }));
vi.mock("@/atlas/segments", async (orig) => ({ ...(await orig<typeof import("@/atlas/segments")>()), lireSegment: lire, filtreEffectif: filtre, scoringCourant: scoring }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/atlas/export/route";
import { Introuvable } from "@/atlas/segments";

const ID = "9b2d1c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e";
const req = (q: string) => new NextRequest(`https://prospection.test/api/atlas/export?${q}`);

beforeEach(() => {
  ctx.mockResolvedValue({ userId: "u-1", tenantId: "t-1" });
  tenant.mockResolvedValue({ plan: "pro" });
  lire.mockResolvedValue({ id: ID, nom: "Éleveurs Rhône", colonnes: ["taille"] });
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
  });

  test("CSV ; segment d'un autre espace : 404", async () => {
    const c = await GET(req(`segment_id=${ID}&format=csv`));
    expect(c.headers.get("content-type")).toContain("text/csv");
    expect([...Buffer.from(await c.arrayBuffer()).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM : Excel lit l'UTF-8
    lire.mockRejectedValueOnce(new Introuvable("segment introuvable"));
    expect((await GET(req(`segment_id=${ID}`))).status).toBe(404);
  });
});
