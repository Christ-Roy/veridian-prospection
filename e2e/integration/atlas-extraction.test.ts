/**
 * extraire_segment (VER-242) sur une vraie base PostgreSQL : curseur stable quand le segment bouge et quand ODH
 * publie entre deux pages, rejeu identique et non recompté, quota en base (redémarrage, appels simultanés),
 * plan payant, isolation entre espaces. Exige DATABASE_URL (job `integration`).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const odh = vi.hoisted(() => ({ lignes: [] as { siren: string; email: string; ok: boolean; rang: number }[], version: "R1" }));
vi.mock("@/atlas/source", async (o) => ({
  ...(await o<typeof import("@/atlas/source")>()),
  sourceMarche: () => ({
    sirensEnvoyables: async (_f: unknown, _s: unknown, plafond: number) => {
      const l = odh.lignes.filter((x) => x.ok).sort((a, b) => b.rang - a.rang || (a.siren < b.siren ? -1 : 1));
      return { sirens: l.slice(0, plafond).map((x) => x.siren), total: l.length, version: odh.version };
    },
    extraire: async (sirens: string[]) => {
      const v = new Set(sirens);
      // Ordre de la base volontairement autre que celui de la liste figée.
      return odh.lignes.filter((x) => x.ok && v.has(x.siren)).sort((a, b) => (a.siren < b.siren ? 1 : -1)).map((x) => ({ siren: x.siren, email: x.email, raison_sociale: x.siren }));
    },
  }),
}));

import { prisma } from "@/lib/prisma";
import { encoderCurseur, extraireSegment, QUOTA_EXTRACTION_JOUR, RefusExtraction, type PageExtraite } from "@/atlas/extraction";
import * as seg from "@/atlas/segments";

const id = randomUUID().slice(0, 8);
const H = { id: "humain", via: "interface" as const };
const T: Record<string, { t: string; u: string }> = {};
const FILTRE = (dep: string) => ({ conditions: [{ champ: "departement", op: "dans", valeur: [dep] }] });

beforeAll(async () => {
  for (const [nom, plan] of [["paye", "business"], ["gratuit", "freemium"], ["autre", "business"]]) {
    const u = await prisma.user.create({ data: { email: `atlas-ext-${nom}-${id}@exemple.invalid` } });
    const t = await prisma.tenant.create({ data: { userId: u.id, name: nom, slug: `atlas-ext-${nom}-${id}`, plan } });
    T[nom] = { t: t.id, u: u.id };
  }
});
beforeEach(async () => {
  const tenants = Object.values(T).map((x) => x.t);
  await prisma.atlasExport.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.atlasExtraction.deleteMany({ where: { tenantId: { in: tenants } } });
  odh.version = "R1";
  odh.lignes = Array.from({ length: 2500 }, (_, i) => ({ siren: String(100000000 + i), email: `e${i}@exemple.invalid`, ok: true, rang: (i * 7919) % 1000 }));
});
afterAll(async () => {
  const tenants = Object.values(T).map((x) => x.t);
  await prisma.atlasExport.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.atlasExtraction.deleteMany({ where: { tenantId: { in: tenants } } });
  const ids = (await prisma.atlasSegment.findMany({ where: { tenantId: { in: tenants } }, select: { id: true } })).map((x) => x.id);
  await prisma.atlasSegmentVersion.deleteMany({ where: { segmentId: { in: ids } } });
  await prisma.atlasSegment.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.$disconnect();
});

const appelant = (n = "paye") => ({ tenantId: T[n].t, userId: T[n].u, client: "test" });
const segment = async (n = "paye") => (await seg.creerSegment(T[n].t, { nom: "S", filtre: FILTRE("69") }, H)).id;
const page = (s: string, curseur?: string | null, limite = 1000, n = "paye") => extraireSegment(appelant(n), { segmentId: s, curseur, limite });
const sirens = (p: PageExtraite) => [...p.lignes.map((l) => l.siren), ...p.retires];

describe("curseur stable", () => {
  test("le segment bouge et ODH publie entre deux pages : ni doublon ni trou, retirés signalés sans coordonnées", async () => {
    const s = await segment();
    const attendu = odh.lignes.map((x) => x.siren).sort();
    const p1 = await page(s);
    expect(p1).toMatchObject({ total: 2500, quota_restant_aujourdhui: 4000 });
    // Le segment change de définition ; ODH publie : ordre bouleversé, 300 nouvelles fiches, une fiche bloquée.
    await seg.modifierSegment(T.paye.t, s, { filtre: FILTRE("38") }, H);
    const restants = attendu.filter((x) => !sirens(p1).includes(x));
    const piege = restants[0];
    odh.version = "R2";
    odh.lignes = odh.lignes.map((x) => ({ ...x, rang: 1000 - x.rang, ok: x.siren !== piege })).reverse();
    for (let i = 0; i < 300; i++) odh.lignes.push({ siren: String(200000000 + i), email: "n@exemple.invalid", ok: true, rang: 9999 });
    const p2 = await page(s, p1.curseur_suivant);
    const p3 = await page(s, p2.curseur_suivant);
    expect(p3.curseur_suivant).toBeNull();
    const tous = [p1, p2, p3].flatMap(sirens);
    expect(new Set(tous).size).toBe(tous.length);
    expect([...tous].sort()).toEqual(attendu);
    expect([...p2.retires, ...p3.retires]).toEqual([piege]);
    expect(JSON.stringify([p2.lignes, p3.lignes])).not.toContain(piege);
    expect(p3.extraction.version_odh).toBe("R1");
  });

  test("deux appels au même curseur (ou sans curseur) rendent la même page, comptée une fois, même avec une limite plus grande", async () => {
    const s = await segment();
    const a = await page(s, null, 700);
    const b = await page(s, null, 1000);
    expect(b).toEqual(a);
    const c = await page(s, a.curseur_suivant, 700);
    expect(await page(s, a.curseur_suivant, 700)).toEqual(c);
    expect(c.quota_restant_aujourdhui).toBe(QUOTA_EXTRACTION_JOUR - 1400);
    expect(await prisma.atlasExport.count({ where: { tenantId: T.paye.t } })).toBe(2);
  });

  test("réponse coupée en route : la page se relit par morceaux au même curseur, sans trou, doublon ni recompte", async () => {
    const s = await segment();
    const grande = await page(s, null, 1000);
    const lus: string[] = [];
    let c: string | null = null;
    for (let i = 0; i < 4; i++) {
      const p = await page(s, c, 300);
      lus.push(...sirens(p));
      c = p.curseur_suivant;
      expect(p.quota_restant_aujourdhui).toBe(QUOTA_EXTRACTION_JOUR - 1000);
    }
    expect(lus).toEqual(sirens(grande)); // 300 + 300 + 300 + 100, dans le même ordre
    expect(c).toBe(grande.curseur_suivant);
    expect((await page(s, c, 300)).quota_restant_aujourdhui).toBe(QUOTA_EXTRACTION_JOUR - 1300);
  });

  test("curseur au-delà de ce qui est servi, d'un autre segment ou expiré : refusé", async () => {
    const s = await segment();
    const s2 = await segment();
    const p1 = await page(s, null, 100);
    const e = await prisma.atlasExtraction.findFirstOrThrow({ where: { segmentId: s } });
    await expect(page(s, encoderCurseur(e.id, 150))).rejects.toThrow(/Curseur invalide/);
    await expect(page(s, encoderCurseur(e.id, 999999))).rejects.toThrow(/Curseur invalide/);
    await expect(page(s2, p1.curseur_suivant)).rejects.toThrow(/Curseur invalide/);
    await expect(page(s, "n'importe quoi")).rejects.toThrow(/Curseur invalide/);
    await prisma.atlasExtraction.update({ where: { id: e.id }, data: { expireLe: new Date(0) } });
    await expect(page(s, p1.curseur_suivant)).rejects.toThrow(/expiré/);
  });

  test("segment vide : une page vide, rien de compté", async () => {
    odh.lignes = [];
    const p = await page(await segment());
    expect(p).toMatchObject({ lignes: [], retires: [], curseur_suivant: null, total: 0, quota_restant_aujourdhui: QUOTA_EXTRACTION_JOUR });
    expect(await prisma.atlasExport.count({ where: { tenantId: T.paye.t } })).toBe(0);
  });
});

describe("quota en base", () => {
  const beaucoup = () => {
    odh.lignes = Array.from({ length: 6000 }, (_, i) => ({ siren: String(300000000 + i), email: `q${i}@exemple.invalid`, ok: true, rang: 0 }));
  };

  test("5 000 lignes par jour, refus ensuite, reprise le lendemain au même curseur sans trou ; survit à un redémarrage", async () => {
    beaucoup();
    const s = await segment();
    let p = await page(s);
    const lus = [...sirens(p)];
    let dernier = p.curseur_suivant;
    for (let i = 0; i < 4; i++) {
      p = await page(s, dernier);
      lus.push(...sirens(p));
      dernier = p.curseur_suivant;
    }
    expect(p.quota_restant_aujourdhui).toBe(0);
    await expect(page(s, dernier)).rejects.toThrow(/Quota du jour atteint/);
    // « Redémarrage » : module rechargé, donc mémoire vide. Le refus tient, il vient de la base.
    vi.resetModules();
    const neuf = await import("@/atlas/extraction");
    await expect(neuf.extraireSegment(appelant(), { segmentId: s, curseur: dernier, limite: 1 })).rejects.toThrow(/Quota du jour atteint/);
    // Un autre espace garde son quota.
    expect((await page(await segment("autre"), null, 10, "autre")).lignes).toHaveLength(10);
    // Le lendemain.
    await prisma.$executeRaw`UPDATE atlas_exports SET cree_le = cree_le - interval '1 day' WHERE tenant_id = ${T.paye.t}::uuid`;
    p = await page(s, dernier);
    lus.push(...sirens(p));
    expect(p.curseur_suivant).toBeNull();
    expect(new Set(lus).size).toBe(6000);
    expect(lus).toHaveLength(6000);
  });

  test("appels simultanés, deux instances : jamais plus de 5 000 lignes, une seule liste figée", async () => {
    beaucoup();
    vi.resetModules();
    const autre = await import("@/atlas/extraction"); // seconde instance du module, sans mémoire commune
    const segs = await Promise.all(Array.from({ length: 4 }, () => segment()));
    const r = await Promise.allSettled(
      segs.flatMap((s) => [extraireSegment, autre.extraireSegment].map((f) => f(appelant(), { segmentId: s, limite: 1000 }))),
    );
    expect(r.every((x) => x.status === "fulfilled")).toBe(true);
    expect(await prisma.atlasExtraction.count({ where: { tenantId: T.paye.t } })).toBe(4);
    // Deux pages suivantes par liste, toutes en même temps : il ne reste que 1 000 lignes pour 4 000 demandées.
    const es = await prisma.atlasExtraction.findMany({ where: { tenantId: T.paye.t } });
    await Promise.allSettled(es.map((e, i) => (i % 2 ? extraireSegment : autre.extraireSegment)(appelant(), { segmentId: e.segmentId, curseur: encoderCurseur(e.id, 1000), limite: 1000 })));
    const somme = await prisma.atlasExport.aggregate({ _sum: { lignes: true }, where: { tenantId: T.paye.t } });
    expect(somme._sum.lignes).toBe(QUOTA_EXTRACTION_JOUR);
  });
});

describe("droits et trace", () => {
  test("plan gratuit refusé, espace d'un autre invisible, plan perdu en cours d'extraction : arrêt", async () => {
    await expect(page(await segment("gratuit"), null, 10, "gratuit")).rejects.toThrow(RefusExtraction);
    const s = await segment();
    const p = await page(s, null, 10);
    await expect(page(s, p.curseur_suivant, 10, "autre")).rejects.toThrow(/Curseur invalide/);
    await expect(page(s, null, 10, "autre")).rejects.toThrow(seg.Introuvable);
    await prisma.tenant.update({ where: { id: T.paye.t }, data: { plan: "freemium" } });
    await expect(page(s, p.curseur_suivant, 10)).rejects.toThrow(/plans payants/);
    await prisma.tenant.update({ where: { id: T.paye.t }, data: { plan: "business" } });
  });

  test("chaque page est tracée : qui, quel client, quel segment et version, combien", async () => {
    const s = await segment();
    await page(s, null, 25);
    const l = await prisma.atlasExport.findMany({ where: { tenantId: T.paye.t } });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ userId: T.paye.u, client: "test", canal: "mcp", segmentId: s, segmentVersion: 1, debut: 0, lignes: 25 });
  });
});
