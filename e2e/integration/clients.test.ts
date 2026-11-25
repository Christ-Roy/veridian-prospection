/** Clients importés : espace étanche, pénétration, filtre « Est déjà client », marquage. Source simulée, vraie base. Exige DATABASE_URL. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

vi.hoisted(() => Object.assign(process.env, { ATLAS_SIMULE: "1" }));
vi.mock("@/lib/auth-config", () => ({ auth: async () => null }));

import { avecClients, importerClients, sirensClients, sirenValide } from "@/atlas/clients";
import { compilerFiltre } from "@/atlas/filtres";
import { compilerMaitre } from "@/atlas/maitre";
import { sourceMarche } from "@/atlas/source";
import { traiter } from "@/lib/mcp/protocole";
import { prisma } from "@/lib/prisma";

const A = randomUUID(), B = randomUUID();
const DEP = { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }] };
let clients: string[];
async function appel(tenantId: string, name: string, args: object = {}, role: "member" | "viewer" = "member") {
  const r = await traiter({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {
    ctx: { userId: randomUUID(), email: "x@y.invalid", tenantId, tenantOwnerId: null, workspaces: [{ id: "w", name: "W", slug: "w", role, visibilityScope: "all" }], isAdmin: false, activeWorkspaceId: "w" }, workspaceId: "w",
  });
  if (r?.error) return { erreur: r.error.message };
  const x = r!.result as { isError?: boolean; content: { text: string }[] };
  return x.isError ? { erreur: x.content[0].text } : JSON.parse(x.content[0].text);
}
const poser = (t: string, l: string[]) => prisma.atlasClient.createMany({ data: l.map((siren) => ({ tenantId: t, siren, ajoutePar: "t" })) });
beforeAll(async () => {
  // Les SIREN simulés (900000xxx) n'ont pas tous une clé juste : posés en base, la lecture ne juge pas.
  const r = await sourceMarche().apercu(DEP, { colonnes: ["nom"], page: 1, parPage: 30 } as never);
  clients = r.lignes.slice(0, 7).map((l) => String(l.siren));
  await poser(A, clients);
});
afterAll(async () => {
  const s = await prisma.atlasSegment.findMany({ where: { tenantId: { in: [A, B] } }, select: { id: true } });
  await prisma.atlasSegmentVersion.deleteMany({ where: { segmentId: { in: s.map((x) => x.id) } } });
  await prisma.atlasSegment.deleteMany({ where: { tenantId: { in: [A, B] } } });
  await prisma.atlasClient.deleteMany({ where: { tenantId: { in: [A, B] } } });
  await prisma.$disconnect();
});

test("import : numéros lus, doublons et faux écartés, rejeu sans effet, plafond dit", async () => {
  const t = randomUUID();
  expect(await importerClients(t, "u", ["552 032 534", "55203253400646", "542107651", "0612345678", "n'importe quoi", ""])).toEqual({ recus: 6, ajoutes: 2, deja: 0, invalides: 2, exemples_invalides: ["0612345678", "n'importe quoi"], total: 2 });
  expect(await importerClients(t, "u", ["552032534"])).toMatchObject({ ajoutes: 0, deja: 1, total: 2 });
  expect(await sirensClients(t)).toEqual(["542107651", "552032534"]);
  const valides: string[] = [];
  for (let i = 100000000; valides.length < 20_000; i++) if (sirenValide(String(i))) valides.push(String(i));
  await expect(importerClients(t, "u", valides)).rejects.toThrow(/20.000 clients au plus/);
  expect(await sirensClients(t)).toHaveLength(2);
  await prisma.atlasClient.deleteMany({ where: { tenantId: t } });
});
test("pénétration : clients du marché sur entreprises du marché ; hors marché non comptés ; conditions hors définition dites", async () => {
  const p = await appel(A, "penetration_marche", { filtre: DEP });
  const m = await appel(A, "analyser_marche", { filtre: DEP });
  expect(p).toMatchObject({ clients_importes: 7, clients_dans_le_marche: 7, entreprises_du_marche: m.total.entreprises, conditions_ignorees: [] });
  expect(p.taux_pct).toBeCloseTo((7 / m.total.entreprises) * 100, 3);
  expect((await appel(A, "penetration_marche", { filtre: { conditions: [{ champ: "departement", op: "dans", valeur: ["38"] }] } })).clients_dans_le_marche).toBe(0);
  const avecEmail = await appel(A, "penetration_marche", { filtre: { conditions: [...DEP.conditions, { champ: "email", op: "renseigne", valeur: true }] } });
  expect([avecEmail.clients_dans_le_marche, avecEmail.conditions_ignorees]).toEqual([7, [{ champ: "email", op: "renseigne", valeur: true }]]);
  const axe = await appel(A, "penetration_marche", { filtre: DEP, axe: "departement" });
  expect(axe.lignes).toEqual([expect.objectContaining({ cle: "69", clients: 7, entreprises: m.total.entreprises })]);
});
test("étanche : un autre espace n'a aucun client, ni dans le taux, ni dans le filtre, ni dans les marques", async () => {
  expect(await appel(B, "penetration_marche", { filtre: DEP })).toMatchObject({ clients_importes: 0, clients_dans_le_marche: 0, taux_pct: 0 });
  const f = (v: boolean) => ({ filtre: { conditions: [...DEP.conditions, { champ: "client", op: "est", valeur: v }] }, par_page: 50 });
  const tout = (await appel(B, "explorer_marche", { filtre: DEP })).total;
  expect([(await appel(B, "explorer_marche", f(true))).total, (await appel(B, "explorer_marche", f(false))).total]).toEqual([0, tout]);
  expect([(await appel(A, "explorer_marche", f(true))).total, (await appel(A, "explorer_marche", f(false))).total]).toEqual([7, tout - 7]);
});
test("marqués dans les listes et sur la fiche", async () => {
  const r = await appel(A, "explorer_marche", { filtre: DEP, par_page: 30 });
  expect(r.lignes.filter((l: { client?: true }) => l.client).map((l: { siren: string }) => l.siren).sort()).toEqual([...clients].sort());
  expect((await appel(A, "fiche_entreprise_atlas", { siren: clients[0] })).client).toBe(true);
  expect((await appel(B, "fiche_entreprise_atlas", { siren: clients[0] })).client).toBeUndefined();
});
test("une cible « hors mes clients » : enregistrée, comptée, classée ; jamais une colonne", async () => {
  const s = await appel(A, "creer_segment", { nom: "Hors clients", filtre: { conditions: [...DEP.conditions, { champ: "client", op: "est", valeur: false }] } });
  const tout = (await appel(A, "explorer_marche", { filtre: DEP })).total;
  expect(s.total).toBe(tout - 7);
  expect((await appel(A, "classer_segment", { segment_id: s.id, par_page: 50 })).lignes.some((l: { siren: string }) => clients.includes(l.siren))).toBe(false);
  expect((await appel(A, "modifier_segment", { segment_id: s.id, colonnes: ["nom", "client"] })).erreur).toMatch(/colonnes/);
  expect((await appel(A, "explorer_marche", { filtre: DEP, colonnes: ["client"] })).erreur).toMatch(/colonne inconnue/);
  const resume = await appel(A, "clients_resume");
  expect(resume).toMatchObject({ clients: 7, marches: [expect.objectContaining({ nom: "Hors clients", clients: 7, conditions_ignorees: 1 })] });
});
test("hors d'un espace, le filtre se refuse ; jamais ignoré en silence ; les numéros passent en paramètres, par lots", async () => {
  const F = { conditions: [{ champ: "client", op: "est", valeur: true }] };
  expect(() => compilerFiltre(F)).toThrow(/pas disponible ici/);
  expect(() => compilerMaitre(F)).toThrow(/pas disponible ici/);
  const gros = Array.from({ length: 12_000 }, (_, i) => String(300000000 + i));
  await prisma.atlasClient.deleteMany({ where: { tenantId: B } });
  await poser(B, gros);
  await new Promise((r) => setTimeout(r, 0));
  const { importerClients: imp } = await import("@/atlas/clients");
  await imp(B, "t", ["552032534"]); // vide le cache
  const c = await avecClients(B, async () => compilerFiltre(F));
  expect(c.where.match(/siren IN/g)).toHaveLength(3);
  expect(c.where).not.toContain("300000000");
  expect(Object.values(c.params).map((x) => (x.valeur as string[]).length)).toEqual([5000, 5000, 2001]);
});
test("un lecteur voit le taux, il n'importe ni ne retire", async () => {
  expect((await appel(A, "penetration_marche", { filtre: DEP }, "viewer")).clients_dans_le_marche).toBe(7);
  for (const n of ["importer_clients", "retirer_clients"]) expect((await appel(A, n, { numeros: ["552032534"] }, "viewer")).erreur).toMatch(/outil inconnu/);
  expect((await appel(A, "retirer_clients", {})).erreur).toMatch(/tous = true/);
  expect(await appel(A, "retirer_clients", { numeros: [clients[0]] })).toMatchObject({ retires: 1, total: 6 });
  expect(await appel(A, "retirer_clients", { tous: true })).toMatchObject({ total: 0 });
});

test("règles proposées : ce qui distingue vraiment les clients, avec ses deux pourcentages ; trop peu de clients = dit", async () => {
  const { juger, proposerPriorite } = await import("@/atlas/suggestion");
  expect(juger(20, 40, 1000, 10_000)).toMatchObject({ pc: 0.5, pt: 0.1 });
  for (const x of [[2, 40, 10, 10_000], [12, 100, 1000, 10_000], [40, 40, 10_000, 10_000], [0, 0, 5, 10], [5, 12, 3000, 10_000]] as const) expect([x, juger(x[0], x[1], x[2], x[3])]).toEqual([x, null]);
  const C = randomUUID(), aut = { id: "u", via: "interface" as const };
  const m = await (await import("@/atlas/segments")).creerSegment(C, { nom: "Tout le 69", filtre: { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }] } }, aut);
  expect(await avecClients(C, () => proposerPriorite(C, m.id))).toMatchObject({ clients: 0, regles: [], message: expect.stringMatching(/au moins 10 clients/) });
  // Clients choisis tous de la même taille : elle doit ressortir, avec ses deux parts.
  const t = (await sourceMarche().repartition({ conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }] }, "taille")).at(-1)!; // la moins fréquente
  const l = (await sourceMarche().apercu({ conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }, { champ: "taille", op: "dans", valeur: [t.cle] }] }, { colonnes: ["nom"], page: 1, parPage: 40 } as never)).lignes;
  await poser(C, l.map((x) => String(x.siren)));
  (await import("@/atlas/clients")).importerClients(C, "u", []).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 200));
  const p = await avecClients(C, () => proposerPriorite(C, m.id));
  expect(p.clients).toBe(l.length);
  const r = p.regles.find((x) => x.condition.champ === "taille")!;
  expect(r).toMatchObject({ condition: { champ: "taille", op: "dans", valeur: [t.cle] }, part_clients_pct: 100 });
  expect(r.part_segment_pct).toBeLessThan(50);
  expect(p.regles.some((r) => r.condition.champ === "departement" || r.condition.champ === "client")).toBe(false);
  await prisma.atlasSegmentVersion.deleteMany({ where: { segmentId: m.id } });
  await prisma.atlasSegment.deleteMany({ where: { tenantId: C } });
  await prisma.atlasClient.deleteMany({ where: { tenantId: C } });
});
