/**
 * Fils de « Mon IA » (CONTRAT-HUB §5.24, VER-203) sur vraie base, l'épreuve du contrat : non signé 401, rejeu v2 401, fil d'un autre 404,
 * PUT puis GET identiques, plus de 1 Mo 413 ; et le fil part avec le membre retiré. Signé comme le Hub (v2). Exige DATABASE_URL.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const SECRET = vi.hoisted(() => (process.env.HUB_API_SECRET = "secret-epreuve-fils-ia-0123456789abcdef"));

import { GET, PUT } from "@/app/api/hub/ia/fils/[session]/route";
import { POST as retirer } from "@/app/api/tenants/[id]/remove-member/route";
import { prisma } from "@/lib/prisma";

const BASE = "https://prospection.app.veridian.site";
const crees: { u: string[]; t: string[] } = { u: [], t: [] };
let patron: { id: string; hub: string }, membre: { id: string; hub: string }, T: string, HUB_T: string;

let n = 0;
function signee(methode: "GET" | "PUT" | "POST", url: string, corps = "", entetes: Record<string, string> = {}) {
  const ts = Date.now() + n++; // un horodatage par appel : deux appels identiques ne se prennent pas pour un rejeu
  const u = new URL(url);
  const empreinte = createHash("sha256").update(corps).digest("hex");
  const sig = createHmac("sha256", SECRET).update([String(Math.floor(ts)), methode, u.pathname, u.search.slice(1), empreinte].join("\n")).digest("hex");
  const h = { "x-veridian-timestamp": String(Math.floor(ts)), "x-veridian-hub-signature": sig, "x-veridian-sig-version": "2", "content-type": "application/json", ...entetes };
  return () => new NextRequest(url, { method: methode, headers: h, ...(methode === "GET" ? {} : { body: corps }) });
}
const ctx = (session: string) => ({ params: Promise.resolve({ session }) });
const lire = (session: string, hub_user_id: string, tenant_id = HUB_T) => signee("GET", `${BASE}/api/hub/ia/fils/${session}?hub_user_id=${hub_user_id}&tenant_id=${tenant_id}`);
const ecrire = (session: string, corps: object) => signee("PUT", `${BASE}/api/hub/ia/fils/${session}`, JSON.stringify(corps));
const FIL = [{ id: "m1", role: "user", parts: [{ type: "text", text: "Combien de plombiers en Isère ?" }] }, { id: "m2", role: "assistant", parts: [{ type: "text", text: "67 contactables." }] }];

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const id = randomUUID().slice(0, 8);
  const u = async (n: string) => {
    const hub = randomUUID();
    const r = await prisma.user.create({ data: { email: `fil-${n}-${id}@exemple.invalid`, hubUserId: hub } });
    crees.u.push(r.id);
    return { id: r.id, hub };
  };
  patron = await u("patron");
  membre = await u("membre");
  HUB_T = randomUUID();
  T = (await prisma.tenant.create({ data: { userId: patron.id, name: "Fils", slug: `fils-${id}`, plan: "pro", status: "active", hubTenantId: HUB_T } })).id;
  crees.t.push(T);
  const W = (await prisma.workspace.create({ data: { tenantId: T, name: "W", slug: "default" } })).id;
  for (const m of [patron, membre]) await prisma.workspaceMember.create({ data: { workspaceId: W, userId: m.id, role: "admin" } });
});
afterAll(async () => {
  await prisma.iaFil.deleteMany({ where: { tenantId: { in: crees.t } } });
  await prisma.workspaceMember.deleteMany({ where: { workspace: { tenantId: { in: crees.t } } } });
  await prisma.workspace.deleteMany({ where: { tenantId: { in: crees.t } } });
  await prisma.tenant.deleteMany({ where: { id: { in: crees.t } } });
  await prisma.user.deleteMany({ where: { id: { in: crees.u } } });
  await prisma.compteur.deleteMany({ where: { cle: { startsWith: "hub-sig:" } } });
  await prisma.$disconnect();
});

test("PUT puis GET du même triplet : mêmes messages ; un PUT remplace le fil entier", async () => {
  const s = randomUUID();
  expect((await PUT(ecrire(s, { hub_user_id: patron.hub, tenant_id: HUB_T, messages: FIL })(), ctx(s))).status).toBe(200);
  const r = await GET(lire(s, patron.hub)(), ctx(s));
  expect(r.status).toBe(200);
  expect((await r.json()).messages).toEqual(FIL);
  await PUT(ecrire(s, { hub_user_id: patron.hub, tenant_id: HUB_T, messages: FIL.slice(0, 1) })(), ctx(s));
  expect((await (await GET(lire(s, patron.hub)(), ctx(s))).json()).messages).toEqual(FIL.slice(0, 1));
});

test("appel du Hub par le fetch de Node (il pose sec-fetch-mode: cors) : accepté, PUT puis GET", async () => {
  // En-têtes mesurés le 26/11 sur Node 22 : le Hub les envoie tous, un garde qui les refuse coupe le contrat entier.
  const node = { "sec-fetch-mode": "cors", accept: "*/*", "accept-language": "*", "user-agent": "node" };
  const s = randomUUID();
  const corps = JSON.stringify({ hub_user_id: patron.hub, tenant_id: HUB_T, messages: FIL });
  expect((await PUT(signee("PUT", `${BASE}/api/hub/ia/fils/${s}`, corps, node)(), ctx(s))).status).toBe(200);
  const r = await GET(signee("GET", `${BASE}/api/hub/ia/fils/${s}?hub_user_id=${patron.hub}&tenant_id=${HUB_T}`, "", node)(), ctx(s));
  expect(r.status).toBe(200);
  expect((await r.json()).messages).toEqual(FIL);
});

test("non signé 401, rejeu v2 401, appel de navigateur 401", async () => {
  const s = randomUUID();
  expect((await GET(new NextRequest(`${BASE}/api/hub/ia/fils/${s}?hub_user_id=${patron.hub}&tenant_id=${HUB_T}`), ctx(s))).status).toBe(401);
  const une = lire(s, patron.hub);
  expect((await GET(une(), ctx(s))).status).toBe(404);
  expect((await GET(une(), ctx(s))).status).toBe(401);
  expect((await GET(signee("GET", `${BASE}/api/hub/ia/fils/${s}?hub_user_id=${patron.hub}&tenant_id=${HUB_T}`, "", { origin: BASE })(), ctx(s))).status).toBe(401);
  // Un navigateur pose toujours sec-fetch-site, même sans origin (GET de même origine) : refusé avant la signature.
  expect((await GET(signee("GET", `${BASE}/api/hub/ia/fils/${s}?hub_user_id=${patron.hub}&tenant_id=${HUB_T}`, "", { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" })(), ctx(s))).status).toBe(401);
});

test("le fil d'un autre : 404 en lecture (jamais 403), 409 fil_autre_auteur en écriture, sans rien écrire", async () => {
  const s = randomUUID();
  await PUT(ecrire(s, { hub_user_id: patron.hub, tenant_id: HUB_T, messages: FIL })(), ctx(s));
  expect((await GET(lire(s, membre.hub)(), ctx(s))).status).toBe(404);
  expect((await GET(lire(s, patron.hub, randomUUID())(), ctx(s))).status).toBe(404);
  const r = await PUT(ecrire(s, { hub_user_id: membre.hub, tenant_id: HUB_T, messages: [] })(), ctx(s));
  expect([r.status, (await r.json()).error]).toEqual([409, "fil_autre_auteur"]);
  expect((await (await GET(lire(s, patron.hub)(), ctx(s))).json()).messages).toEqual(FIL);
});

test("plus de 1 Mo ou de 200 messages : 413 ; inconnu du Hub ou d'un espace non relié : 404", async () => {
  const s = randomUUID();
  const gros = [{ id: "g", role: "user", parts: [{ type: "text", text: "x".repeat(1_100_000) }] }];
  expect((await PUT(ecrire(s, { hub_user_id: patron.hub, tenant_id: HUB_T, messages: gros })(), ctx(s))).status).toBe(413);
  const longs = Array.from({ length: 201 }, (_, i) => ({ id: `m${i}`, role: "user", parts: [] }));
  expect((await PUT(ecrire(s, { hub_user_id: patron.hub, tenant_id: HUB_T, messages: longs })(), ctx(s))).status).toBe(413);
  expect((await PUT(ecrire(s, { hub_user_id: randomUUID(), tenant_id: HUB_T, messages: FIL })(), ctx(s))).status).toBe(404);
  expect((await PUT(ecrire(s, { hub_user_id: patron.hub, tenant_id: randomUUID(), messages: FIL })(), ctx(s))).status).toBe(404);
  expect(await prisma.iaFil.count({ where: { sessionId: s } })).toBe(0);
});

test("retrait du membre : ses fils dans l'espace partent, ceux du patron restent ; il ne peut plus en écrire", async () => {
  const sm = randomUUID(), sp = randomUUID();
  await PUT(ecrire(sm, { hub_user_id: membre.hub, tenant_id: HUB_T, messages: FIL })(), ctx(sm));
  await PUT(ecrire(sp, { hub_user_id: patron.hub, tenant_id: HUB_T, messages: FIL })(), ctx(sp));
  const corps = JSON.stringify({ hub_user_id: membre.hub });
  const r = await retirer(signee("POST", `${BASE}/api/tenants/${T}/remove-member`, corps)(), { params: Promise.resolve({ id: T }) });
  expect(r.status).toBe(200);
  expect(await prisma.iaFil.count({ where: { sessionId: sm } })).toBe(0);
  expect(await prisma.iaFil.count({ where: { sessionId: sp } })).toBe(1);
  expect((await PUT(ecrire(sm, { hub_user_id: membre.hub, tenant_id: HUB_T, messages: FIL })(), ctx(sm))).status).toBe(404);
});
