/** API par marché et rapport PDF : clé réelle, vraie route, espace étanche, aucune coordonnée. Exige DATABASE_URL. */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const s = vi.hoisted(() => {
  Object.assign(process.env, { ATLAS_SIMULE: "1" });
  return { user: null as null | { id: string; email: string } };
});
vi.mock("@/lib/auth-config", () => ({ auth: async () => (s.user ? { user: s.user } : null) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { GET } from "@/app/api/v1/marches/[[...chemin]]/route";
import { GET as pdf } from "@/app/api/atlas/rapport/route";
import { creerCle } from "@/atlas/acces";
import { OUTILS_ATLAS } from "@/atlas/outils-mcp";
import * as seg from "@/atlas/segments";
import { prisma } from "@/lib/prisma";

const id = randomUUID().slice(0, 8);
const E: Record<string, { t: string; u: string; email: string; cle: string; marche: string; cible: string }> = {};
beforeAll(async () => {
  for (const n of ["a", "b"]) {
    const email = `api-${n}-${id}@exemple.invalid`;
    const u = await prisma.user.create({ data: { email } });
    const t = await prisma.tenant.create({ data: { userId: u.id, name: n, slug: `api-${n}-${id}`, plan: "freemium", status: "active", accesAvance: true } });
    const aut = { id: u.id, via: "interface" as const };
    const m = await seg.creerSegment(t.id, { nom: `Restaurants ${n}`, filtre: { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }] } }, aut);
    const c = await seg.creerSegment(t.id, { nom: `Avec email ${n}`, parentId: m.id, colonnes: ["nom", "email", "telephone"], filtre: { conditions: [{ champ: "email", op: "renseigne", valeur: true }] } }, aut);
    E[n] = { t: t.id, u: u.id, email, cle: (await creerCle({ userId: u.id, tenantId: t.id }, "api")).cle, marche: m.id, cible: c.id };
  }
});
afterAll(async () => {
  const t = Object.values(E).map((x) => x.t);
  const segs = (await prisma.atlasSegment.findMany({ where: { tenantId: { in: t } }, select: { id: true } })).map((x) => x.id);
  await prisma.atlasRapport.deleteMany({ where: { tenantId: { in: t } } });
  await prisma.atlasSegmentVersion.deleteMany({ where: { segmentId: { in: segs } } });
  await prisma.atlasSegment.deleteMany({ where: { id: { in: segs }, parentId: { not: null } } });
  await prisma.atlasSegment.deleteMany({ where: { id: { in: segs } } });
  await prisma.atlasCleApi.deleteMany({ where: { tenantId: { in: t } } });
  await prisma.tenant.deleteMany({ where: { id: { in: t } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(E).map((x) => x.u) } } });
  await prisma.$disconnect();
});
async function api(chemin: string, cle?: string) {
  const [p, q = ""] = chemin.split("?");
  const r = await GET(new NextRequest(`https://x/api/v1/marches/${p}?${q}`, { headers: cle ? { authorization: `Bearer ${cle}` } : {} }), { params: Promise.resolve({ chemin: p ? p.split("/") : undefined }) });
  return { s: r.status, j: await r.json() };
}

test("sans clé, clé fausse : 401 ; la liste ne montre que son espace", async () => {
  expect((await api("")).s).toBe(401);
  expect((await api("", "atl_" + "x".repeat(43))).s).toBe(401);
  const r = await api("", E.a.cle);
  expect(r.j.marches.map((m: { chemin: string; type: string }) => [m.chemin, m.type]).sort()).toEqual([["avec-email-a", "cible"], ["restaurants-a", "marche"]]);
});
test("un marché par son nom ou son identifiant ; celui d'un autre est inconnu", async () => {
  const r = await api("restaurants-a", E.a.cle);
  expect(r.j).toMatchObject({ nom: "Restaurants a", type: "marche", marche: { entreprises: expect.any(Number) }, penetration: { clients_importes: 0 } });
  expect((await api(E.a.marche, E.a.cle)).j.nom).toBe("Restaurants a");
  expect([(await api("restaurants-b", E.a.cle)).s, (await api(E.b.marche, E.a.cle)).s]).toEqual([404, 404]);
});
test("répartition, entreprises paginées, route neuve dès que le marché naît", async () => {
  expect((await api("restaurants-a/repartition?axe=departement", E.a.cle)).j.lignes[0].cle).toBe("69");
  expect((await api("restaurants-a/repartition?axe=email", E.a.cle)).s).toBe(400);
  const p1 = (await api("restaurants-a/entreprises?par_page=5", E.a.cle)).j, p2 = (await api("restaurants-a/entreprises?par_page=5&page=2", E.a.cle)).j;
  expect([p1.lignes.length, p1.page_suivante]).toEqual([5, 2]);
  expect(p2.lignes[0].siren).not.toBe(p1.lignes[0].siren);
  expect((await api("restaurants-a/inconnu", E.a.cle)).s).toBe(404);
  await seg.creerSegment(E.a.t, { nom: "Hôtels", filtre: { conditions: [] } }, { id: E.a.u, via: "interface" });
  expect((await api("hotels", E.a.cle)).s).toBe(200);
  expect(Object.keys((await api("openapi.json", E.a.cle)).j.paths)).toContain("/hotels/entreprises");
});
test("jamais une coordonnée, même une cible dont les colonnes en ont, même en accès avancé", async () => {
  const r = await api("avec-email-a/entreprises?par_page=50", E.a.cle);
  expect(r.j.lignes.length).toBeGreaterThan(5);
  expect(JSON.stringify(r.j)).not.toMatch(/@entreprise|0400000000/);
});
test("rapport : PDF du marché, texte de l'IA compris ; celui d'un autre espace est introuvable ; sans session 401", async () => {
  const o = OUTILS_ATLAS.find((x) => x.name === "creer_rapport")!;
  const ctx = (e: (typeof E)[string]) => ({ ctx: { userId: e.u, email: e.email, tenantId: e.t, tenantOwnerId: e.u, workspaces: [], isAdmin: true, activeWorkspaceId: null }, workspaceId: null, client: "Claude" });
  const r = (await o.run({ segment_id: E.a.cible, titre: "Étude des restaurants", texte: "Un marché dense.\nDeux villes portent 60 % du volume (à vérifier)." }, ctx(E.a))) as { pdf: string };
  const q = new URL(r.pdf).search;
  const lire = async (chemin: string) => pdf(new NextRequest(`https://x/api/atlas/rapport${chemin}`));
  s.user = null;
  expect((await lire(q)).status).toBe(401);
  s.user = { id: E.b.u, email: E.b.email };
  expect([(await lire(q)).status, (await lire(`?segment_id=${E.a.marche}`)).status, (await lire("?id=x")).status]).toEqual([404, 404, 400]);
  s.user = { id: E.a.u, email: E.a.email };
  const p = await lire(q);
  expect([p.status, p.headers.get("content-type")]).toEqual([200, "application/pdf"]);
  const octets = Buffer.from(await p.arrayBuffer());
  const t = octets.toString("latin1");
  expect(t.startsWith("%PDF-1.4")).toBe(true);
  for (const x of ["\\311tude des restaurants", "Un march\\351 dense.", "r\\351dig\\351 par Claude", "D\\351partements en t\\352te", "D\\351finition"]) expect(t).toContain(x);
  expect(t).not.toMatch(/@entreprise/);
  if (process.env.PDF_ECHANTILLON) writeFileSync(process.env.PDF_ECHANTILLON, octets);
  await expect(o.run({ segment_id: E.b.marche, titre: "x", texte: "" }, ctx(E.a))).rejects.toThrow(/introuvable/);
});
