/**
 * Organisations (VER-252) sur une vraie base : un membre invité voit l'organisation et ses segments, choisit où travailler ;
 * le cookie ne donne aucun droit ; retiré, il retombe chez lui. Exige DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

const s = vi.hoisted(() => ({ user: null as null | { id: string; email: string }, cookie: null as string | null }));
vi.mock("@/lib/auth-config", () => ({ auth: async () => (s.user ? { user: s.user } : null) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "veridian-espace" && s.cookie ? { value: s.cookie } : undefined) }) }));

import { GET, POST } from "@/app/api/espaces/route";
import { espacesDe } from "@/lib/auth/espaces";
import { getUserContext, invalidateAllUserContexts, invalidateUserContext } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import * as seg from "@/atlas/segments";

const id = randomUUID().slice(0, 8);
const U: Record<string, { id: string; email: string }> = {}, T: Record<string, string> = {}, W: Record<string, string> = {};
beforeAll(async () => {
  for (const n of ["patron", "membre", "etranger"]) {
    const email = `esp-${n}-${id}@exemple.invalid`;
    const u = await prisma.user.create({ data: { email } });
    const t = await prisma.tenant.create({ data: { userId: u.id, name: `Espace ${n}`, slug: `esp-${n}-${id}`, plan: "pro" } });
    const w = await prisma.workspace.create({ data: { tenantId: t.id, name: "W", slug: "default" } });
    await prisma.workspaceMember.create({ data: { workspaceId: w.id, userId: u.id, role: "admin" } });
    U[n] = { id: u.id, email }; T[n] = t.id; W[n] = w.id;
  }
  await prisma.workspaceMember.create({ data: { workspaceId: W.patron, userId: U.membre.id, role: "viewer" } });
  await seg.creerSegment(T.patron, { nom: "Marché commun", filtre: { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }] } }, { id: U.patron.id, via: "interface" });
});
beforeEach(() => { invalidateAllUserContexts(); s.cookie = null; s.user = U.membre; });
afterAll(async () => {
  const segs = (await prisma.atlasSegment.findMany({ where: { tenantId: { in: Object.values(T) } }, select: { id: true } })).map((x) => x.id);
  await prisma.atlasSegmentVersion.deleteMany({ where: { segmentId: { in: segs } } });
  await prisma.atlasSegment.deleteMany({ where: { id: { in: segs } } });
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: Object.values(W) } } });
  await prisma.tenant.deleteMany({ where: { id: { in: Object.values(T) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(U).map((u) => u.id) } } });
  await prisma.$disconnect();
});
const choisir = (espace: unknown, h: Record<string, string> = {}) => POST(new NextRequest("https://x/api/espaces", { method: "POST", body: JSON.stringify({ id: espace }), headers: { "content-type": "application/json", ...h } }));

test("un membre invité voit les deux organisations, avec son rôle et le nombre de membres", async () => {
  expect(await (await GET()).json()).toEqual({ courant: T.membre, espaces: expect.arrayContaining([
    { id: T.patron, nom: "Espace patron", role: "viewer", membres: 2 }, { id: T.membre, nom: "Espace membre", role: "owner", membres: 1 }]) });
  expect((await espacesDe(U.etranger.id)).map((e) => e.id)).toEqual([T.etranger]);
});
test("il choisit l'organisation : ses segments, son rôle, et pas ses droits d'ailleurs", async () => {
  const r = await choisir(T.patron);
  expect(r.status).toBe(200);
  const c = r.cookies.get("veridian-espace")!;
  expect([c.value, c.httpOnly, c.sameSite]).toEqual([T.patron, true, "lax"]);
  s.cookie = c.value;
  const ctx = (await getUserContext())!;
  expect([ctx.tenantId, ctx.isAdmin, ctx.workspaces.map((w) => w.role)]).toEqual([T.patron, false, ["viewer"]]);
  expect(JSON.stringify(await seg.listerArbre(ctx.tenantId))).toContain("Marché commun");
  s.cookie = T.membre;
  expect((await getUserContext())!.isAdmin).toBe(true);
});
test("qui a fait quoi : le nom de la personne, à défaut le début de son adresse ; une IA garde son libellé", async () => {
  const g = await seg.creerSegment(T.patron, { nom: "Auteurs", filtre: { conditions: [{ champ: "departement", op: "dans", valeur: ["42"] }] } }, { id: U.patron.id, via: "interface" });
  await seg.modifierSegment(T.patron, g.id, { filtre: { conditions: [{ champ: "departement", op: "dans", valeur: ["43"] }] } }, { id: "ia:Claude", via: "mcp" });
  expect((await seg.historique(T.patron, g.id)).filtre.map((v) => [v.auteur_nom, v.via])).toEqual([[null, "mcp"], [`esp-patron-${id}`, "interface"]]);
  await prisma.user.update({ where: { id: U.patron.id }, data: { name: "Paule Martin" } });
  expect((await seg.historique(T.patron, g.id)).filtre[1].auteur_nom).toBe("Paule Martin");
});
test("un cookie forgé, un espace inconnu ou celui d'un autre n'ouvrent rien", async () => {
  for (const c of [T.etranger, randomUUID(), "pas-un-uuid"]) {
    s.cookie = c;
    expect((await getUserContext())!.tenantId).toBe(T.membre);
    expect([400, 404]).toContain((await choisir(c)).status);
  }
  expect((await choisir(T.patron, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  s.user = null;
  expect([(await GET()).status, (await choisir(T.patron)).status]).toEqual([401, 401]);
});
test("retiré de l'organisation, il retombe chez lui et ne peut plus la choisir", async () => {
  s.cookie = T.patron;
  expect((await getUserContext())!.tenantId).toBe(T.patron);
  await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: W.patron, userId: U.membre.id } }, data: { deletedAt: new Date() } });
  invalidateUserContext(U.membre.id);
  expect((await getUserContext())!.tenantId).toBe(T.membre);
  expect((await choisir(T.patron)).status).toBe(404);
});

// ---------------------------------------------------------------- le document du Hub
import { createHmac } from "node:crypto";
import { GET as relire, POST as recevoir } from "@/app/api/hub/organisations/sync/route";
import { GET as ouvrir } from "@/app/api/auth/token/route";
import { POST as emettre } from "@/app/api/sso/issue-magic-link/route";

const SECRET = "secret-hub-".repeat(4);
const signe = (corps: string) => { const ts = Date.now(); return { "content-type": "application/json", "x-veridian-timestamp": String(ts), "x-veridian-hub-signature": createHmac("sha256", SECRET).update(`${ts}.${corps}`).digest("hex") }; };
const HT = randomUUID(), HU = randomUUID(), HN = randomUUID();
const doc = (o: Record<string, unknown> = {}) => ({ hub_tenant_id: HT, version: 100, nom: "Boulangerie Martin", type: "organisation", marque: { nom_affiche: "Martin", logo_url: "https://app.veridian.site/l.png", logo_sombre_url: null, favicon_url: null, couleur_primaire: "#112233", couleur_accent: null }, modules: ["prospection"], reglages: {}, membres: [{ hub_user_id: HN, email: `esp-neuf-${id}@exemple.invalid`, email_proven: true, name: null, role: "member", joined_at: new Date().toISOString() }], ...o });
const pousser = async (o: Record<string, unknown> = {}) => { const c = JSON.stringify(doc(o)); const r = await recevoir(new NextRequest("https://x/api/hub/organisations/sync", { method: "POST", body: c, headers: signe(c) })); return [r.status, await r.json()] as const; };
const version = async (t = HT) => { const r = await relire(new NextRequest(`https://x/api/hub/organisations/sync?hub_tenant_id=${t}`, { headers: signe("") })); return [r.status, (await r.json()).version]; };

test("le document s'applique, se relit, ne recule pas ; membres ajoutés, jamais retirés par absence ; un retiré ne revient que par une adhésion postérieure", async () => {
  vi.stubEnv("HUB_API_SECRET", SECRET); vi.stubEnv("AUTH_SECRET", "session-".repeat(6)); vi.stubEnv("APP_URL", "http://localhost:3000");
  await prisma.tenant.update({ where: { id: T.etranger }, data: { hubTenantId: HT, metadata: { hub_trial: { status: "x" } } } });
  await prisma.user.update({ where: { id: U.etranger.id }, data: { hubUserId: HU } });
  expect(await version()).toEqual([200, null]);
  expect(await version(randomUUID())).toEqual([404, undefined]);
  expect((await pousser({ hub_tenant_id: randomUUID() }))[0]).toBe(404);
  expect((await pousser({ marque: { logo_url: "javascript:alert(1)" } }))[0]).toBe(400);
  expect(await pousser()).toEqual([200, { applied: true, version: 100, refuses: 0 }]);
  expect(await version()).toEqual([200, 100]);
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T.etranger } });
  expect([t.name, (t.metadata as { hub_trial: unknown }).hub_trial]).toEqual(["Boulangerie Martin", { status: "x" }]);
  expect(await pousser()).toEqual([200, { applied: false, reason: "unchanged" }]);
  expect(await pousser({ version: 99, nom: "Vieux" })).toEqual([200, { applied: false, reason: "stale" }]);
  const neuf = await prisma.user.findFirstOrThrow({ where: { hubUserId: HN } });
  U.neuf = { id: neuf.id, email: neuf.email };
  const fiche = () => prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: W.etranger, userId: neuf.id } } });
  expect((await fiche())?.role).toBe("member");
  await pousser({ version: 101, membres: [] });
  expect((await fiche())?.deletedAt).toBeNull();
  await prisma.workspaceMember.updateMany({ where: { userId: neuf.id }, data: { deletedAt: new Date() } });
  await pousser({ version: 102, membres: [{ ...doc().membres[0], joined_at: new Date(Date.now() - 3600_000).toISOString() }] });
  expect((await fiche())?.deletedAt).not.toBeNull();
  await pousser({ version: 103, membres: [{ ...doc().membres[0], joined_at: new Date(Date.now() + 3600_000).toISOString(), role: "inconnu" }] });
  expect([(await fiche())?.deletedAt, (await fiche())?.role]).toEqual([null, "viewer"]);
});
test("une adresse liée à une autre identité du Hub, ou un compte supprimé, n'entre pas : refusé et dit", async () => {
  vi.stubEnv("HUB_API_SECRET", SECRET);
  const m = { email_proven: true, name: null, role: "admin", joined_at: new Date().toISOString() };
  expect((await pousser({ version: 110, membres: [{ ...m, hub_user_id: randomUUID(), email: U.neuf.email }] }))[1]).toMatchObject({ applied: true, refuses: 1 });
  expect(await prisma.workspaceMember.count({ where: { workspaceId: W.etranger, role: "admin", userId: { not: U.etranger.id } } })).toBe(0);
});
test("le rebond pose l'organisation active du Hub si l'on en est membre, sinon on entre comme avant", async () => {
  vi.stubEnv("HUB_API_SECRET", SECRET); vi.stubEnv("AUTH_SECRET", "session-".repeat(6)); vi.stubEnv("APP_URL", "http://localhost:3000");
  const arriver = async (hub_tenant_id?: string) => {
    const c = JSON.stringify({ hub_user_id: HN, email: U.neuf.email, email_proven: true, ...(hub_tenant_id ? { hub_tenant_id } : {}) });
    const r = await emettre(new NextRequest("http://localhost:3000/api/sso/issue-magic-link", { method: "POST", body: c, headers: signe(c) }));
    const s2 = await ouvrir(new NextRequest(`http://localhost:3000/api/auth/token${new URL((await r.json()).magic_link_url).search}`));
    return [s2.cookies.getAll().some((k) => k.name.endsWith("session-token")), s2.cookies.get("veridian-espace")?.value];
  };
  expect(await arriver(HT)).toEqual([true, T.etranger]);
  const autre = randomUUID();
  await prisma.tenant.update({ where: { id: T.patron }, data: { hubTenantId: autre } });
  expect(await arriver(autre)).toEqual([true, undefined]);
  expect(await arriver(randomUUID())).toEqual([true, undefined]);
  expect(await arriver()).toEqual([true, undefined]);
  // Lien bricolé : l'espace d'un autre n'est pas posé.
  const c = JSON.stringify({ hub_user_id: HN, email: U.neuf.email, email_proven: true });
  const r = await emettre(new NextRequest("http://localhost:3000/api/sso/issue-magic-link", { method: "POST", body: c, headers: signe(c) }));
  const u = new URL((await r.json()).magic_link_url); u.searchParams.set("espace", T.patron);
  expect((await ouvrir(new NextRequest(`http://localhost:3000/api/auth/token${u.search}`))).cookies.get("veridian-espace")).toBeUndefined();
});
