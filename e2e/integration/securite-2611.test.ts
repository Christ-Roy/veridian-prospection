/**
 * Chasse sécu du 26/11, rejouée sur vraie base. Exige DATABASE_URL.
 * 1. Rattachement par le Hub (attach-member, sync-member, attach-owner) : jamais le compte d'une autre identité, ni un
 *    compte sans lien dont l'adresse n'est pas prouvée ; aucun lien de connexion rendu dans ces cas.
 * 2. Espace suspendu : fermé dès l'acquittement, rouvert à la reprise ; membre gelé : lecture seule (402 sur écriture).
 * 3. Un autre site ne déclenche pas d'outil Atlas par la session.
 * 4. L'ancien jeton en clair du tenant n'ouvre plus de session.
 * 5. L'export d'écran compte dans les 5 000 lignes du jour de l'espace, avec l'extraction et les envois (Robert, 26/11).
 */
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, expect, test, vi } from "vitest";

const SECRET = vi.hoisted(() => {
  Object.assign(process.env, { ATLAS_SIMULE: "1", APP_URL: "http://localhost:3000", AUTH_SECRET: "secret-de-session-epreuve-0123456789" });
  return (process.env.HUB_API_SECRET = "secret-epreuve-securite-0123456789ab");
});
const s = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/auth-config", () => ({ auth: async () => (s.user ? { user: s.user } : null) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { POST as outil } from "@/app/api/atlas/[outil]/route";
import { GET as moi } from "@/app/api/me/route";
import { POST as reprendre } from "@/app/api/tenants/resume/route";
import { POST as suspendre } from "@/app/api/tenants/suspend/route";
import { espaceHub, espacesDe } from "@/lib/auth/espaces";
import { GET as exporter } from "@/app/api/atlas/export/route";
import { GET as jeton } from "@/app/api/auth/token/route";
import { POST as attachOwner } from "@/app/api/tenants/attach-owner/route";
import { POST as syncMember } from "@/app/api/tenants/[id]/sync-member/route";
import { POST as attachMember } from "@/app/api/veridian/workspaces/[workspaceId]/attach-member/route";
import { oublierDroits } from "@/atlas/acces";
import { QUOTA_EXTRACTION_JOUR, RefusExtraction, reserverExport } from "@/atlas/extraction";
import { invalidateAllUserContexts } from "@/lib/auth/cache-contexte";
import { prisma } from "@/lib/prisma";

const crees: { u: string[]; t: string[] } = { u: [], t: [] };
let victime: { id: string; hub: string; email: string }, sansLien: { id: string; email: string }, T: string, W: string, patron: { id: string; email: string };

const signe = (url: string, corps: object) => {
  const brut = JSON.stringify(corps), ts = String(Date.now());
  return new NextRequest(url, { method: "POST", body: brut, headers: { "content-type": "application/json", "x-veridian-timestamp": ts, "x-veridian-hub-signature": createHmac("sha256", SECRET).update(`${ts}.${brut}`).digest("hex") } });
};
const membresDe = (u: string) => prisma.workspaceMember.count({ where: { userId: u, workspaceId: W, deletedAt: null } });
const jetonsDe = (u: string) => prisma.ssoLoginToken.count({ where: { userId: u } });
const appelOutil = async (nom: string, corps: object = {}, entetes: Record<string, string> = { "content-type": "application/json" }) => {
  const r = await outil(new NextRequest(`https://x/api/atlas/${nom}`, { method: "POST", body: JSON.stringify(corps), headers: entetes }), { params: Promise.resolve({ outil: nom }) });
  return { s: r.status, j: (await r.json()) as Record<string, unknown> };
};

beforeEach(async () => {
  const id = randomUUID().slice(0, 8);
  const hub = randomUUID();
  const v = await prisma.user.create({ data: { email: `victime-${id}@exemple.invalid`, hubUserId: hub } });
  victime = { id: v.id, hub, email: v.email };
  const sl = await prisma.user.create({ data: { email: `sanslien-${id}@exemple.invalid` } });
  sansLien = { id: sl.id, email: sl.email };
  const p = await prisma.user.create({ data: { email: `patron-${id}@exemple.invalid`, hubUserId: randomUUID() } });
  patron = { id: p.id, email: p.email };
  crees.u.push(v.id, sl.id, p.id);
  T = (await prisma.tenant.create({ data: { userId: p.id, name: "Sécu", slug: `secu-${id}`, plan: "pro", status: "active" } })).id;
  crees.t.push(T);
  W = (await prisma.workspace.create({ data: { tenantId: T, name: "W", slug: "default" } })).id;
  await prisma.workspaceMember.create({ data: { workspaceId: W, userId: p.id, role: "owner" } });
  oublierDroits();
  invalidateAllUserContexts();
  s.user = null;
});
afterAll(async () => {
  await prisma.ssoLoginToken.deleteMany({ where: { userId: { in: crees.u } } });
  await prisma.atlasExport.deleteMany({ where: { tenantId: { in: crees.t } } });
  await prisma.atlasSegment.deleteMany({ where: { tenantId: { in: crees.t } } }).catch(() => undefined);
  await prisma.workspaceMember.deleteMany({ where: { workspace: { tenantId: { in: crees.t } } } });
  await prisma.workspace.deleteMany({ where: { tenantId: { in: crees.t } } });
  await prisma.tenant.deleteMany({ where: { id: { in: crees.t } } });
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: crees.u } }, { email: { endsWith: "@exemple.invalid", startsWith: "neuf-" } }] } });
  await prisma.$disconnect();
});

test("attach-member : l'adresse d'une autre identité Hub → 409, rien rattaché, aucun lien de connexion", async () => {
  const r = await attachMember(signe(`https://x/api/veridian/workspaces/${W}/attach-member`, { hub_user_id: randomUUID(), hub_user_email: victime.email, role: "admin", invitation_id: "inv-1", email_proven: true }), { params: Promise.resolve({ workspaceId: W }) });
  expect(r.status).toBe(409);
  expect(((await r.json()) as { error: string }).error).toBe("hub_user_conflict");
  expect(await membresDe(victime.id)).toBe(0);
  expect(await jetonsDe(victime.id)).toBe(0);
});

test("attach-member : compte sans lien et adresse non prouvée → 409 ; prouvée → rattaché, lien de 60 s", async () => {
  const hub = randomUUID();
  const corps = { hub_user_id: hub, hub_user_email: sansLien.email, role: "member", invitation_id: "inv-2" };
  const r1 = await attachMember(signe(`https://x/api/veridian/workspaces/${W}/attach-member`, corps), { params: Promise.resolve({ workspaceId: W }) });
  expect(r1.status).toBe(409);
  expect(await membresDe(sansLien.id)).toBe(0);
  const r2 = await attachMember(signe(`https://x/api/veridian/workspaces/${W}/attach-member`, { ...corps, email_proven: true }), { params: Promise.resolve({ workspaceId: W }) });
  expect(r2.status).toBe(200);
  const j = (await r2.json()) as { expires_at: string; login_url: string };
  expect(Date.parse(j.expires_at) - Date.now()).toBeLessThanOrEqual(61_000);
  expect(await membresDe(sansLien.id)).toBe(1);
  expect((await prisma.user.findUnique({ where: { id: sansLien.id } }))?.hubUserId).toBe(hub);
});

test("sync-member : l'adresse d'une autre identité Hub → 409, rien rattaché", async () => {
  const r = await syncMember(signe(`https://x/api/tenants/${T}/sync-member`, { hub_user_id: randomUUID(), user_email: victime.email, role: "admin" }), { params: Promise.resolve({ id: T }) });
  expect(r.status).toBe(409);
  expect(await membresDe(victime.id)).toBe(0);
});

test("attach-owner : sans hub_user_id → 400 ; adresse d'une autre identité → 409 ; personne ne devient propriétaire", async () => {
  const r1 = await attachOwner(signe("https://x/api/tenants/attach-owner", { tenant_id: T, owner_email: victime.email }));
  expect(r1.status).toBe(400);
  const r2 = await attachOwner(signe("https://x/api/tenants/attach-owner", { tenant_id: T, owner_email: victime.email, hub_user_id: randomUUID() }));
  expect(r2.status).toBe(409);
  expect(await membresDe(victime.id)).toBe(0);
});

test("un compte neuf se rattache sans preuve d'adresse (personne à usurper)", async () => {
  const email = `neuf-${randomUUID().slice(0, 8)}@exemple.invalid`;
  const r = await attachMember(signe(`https://x/api/veridian/workspaces/${W}/attach-member`, { hub_user_id: randomUUID(), hub_user_email: email, role: "member", invitation_id: "inv-3" }), { params: Promise.resolve({ workspaceId: W }) });
  expect(r.status).toBe(200);
});

test("espace suspendu : fermé dès l'acquittement (/api/me, outils, MCP), rouvert dès la reprise", async () => {
  s.user = patron;
  const me = async () => { const r = await moi(); return r.status === 200 ? ((await r.json()) as { workspaces: { id: string }[] }).workspaces.map((w) => w.id) : []; };
  expect(await me()).toEqual([W]); // témoin, et le contexte est maintenant en cache
  expect((await appelOutil("creer_segment", { nom: "Avant", filtre: { conditions: [] } })).s).toBe(200);
  const r = await suspendre(signe("https://x/api/tenants/suspend", { tenant_id: T, reason: "admin_action" }));
  expect(r.status).toBe(200);
  expect(await me()).toEqual([]); // sans attendre l'expiration du cache
  const ferme = await appelOutil("lister_segments_atlas");
  expect(ferme.s).toBe(403); // session valable, aucun espace ouvert : dit, pas « session expirée »
  expect(ferme.j.error).toBe("no_workspace");
  expect((await moi()).status).toBe(403);
  const x = await exporter(new NextRequest(`https://x/api/atlas/export?segment_id=${randomUUID()}&format=csv`));
  expect(x.status).toBe(403);
  const hubT = randomUUID();
  await prisma.tenant.update({ where: { id: T }, data: { hubTenantId: hubT } });
  expect(await espaceHub(patron.id, hubT)).toBe("tenant_suspended");
  expect(await espacesDe(patron.id)).toEqual([]);
  expect((await reprendre(signe("https://x/api/tenants/resume", { tenant_id: T }))).status).toBe(200);
  expect(await me()).toEqual([W]);
  expect(await espaceHub(patron.id, hubT)).toEqual({ id: T });
  expect((await appelOutil("creer_segment", { nom: "Après", filtre: { conditions: [] } })).s).toBe(200);
});

test("membre gelé : écriture 402, lecture servie", async () => {
  await prisma.workspaceMember.updateMany({ where: { workspaceId: W, userId: patron.id }, data: { frozenAt: new Date() } });
  invalidateAllUserContexts();
  s.user = patron;
  expect((await appelOutil("lister_segments_atlas")).s).toBe(200);
  const e = await appelOutil("creer_segment", { nom: "Gelé", filtre: { conditions: [] } });
  expect(e.s).toBe(402);
  expect(e.j.error).toBe("member_frozen");
});

test("un autre site ne déclenche pas d'outil par la session ; le même site, si", async () => {
  s.user = patron;
  expect((await appelOutil("lister_segments_atlas", {}, { "content-type": "application/json", "sec-fetch-site": "cross-site" })).s).toBe(403);
  expect((await appelOutil("lister_segments_atlas", {}, { "content-type": "text/plain" })).s).toBe(403);
  expect((await appelOutil("lister_segments_atlas", {}, { "content-type": "application/json", "sec-fetch-site": "same-origin" })).s).toBe(200);
});

test("l'ancien jeton en clair du tenant, même sans date, n'ouvre plus de session", async () => {
  const brut = `ancien-${randomUUID()}`;
  await prisma.tenant.update({ where: { id: T }, data: { prospectionLoginToken: brut, prospectionLoginTokenCreatedAt: null, prospectionLoginTokenUsedAt: null } });
  const r = await jeton(new NextRequest(`https://x/api/auth/token?t=${brut}`));
  expect(r.headers.get("location")).toContain("error=invalid_token");
  expect(r.headers.get("set-cookie") ?? "").not.toMatch(/session-token/);
});

test("export d'écran : compté dans le quota du jour, deux exports simultanés ne le dépassent pas", async () => {
  const a = { tenantId: T, userId: patron.id, client: null, format: "csv", segmentId: randomUUID(), segmentVersion: 1 };
  // Le reste du jour déjà pris par l'extraction et un envoi.
  await prisma.atlasExport.createMany({ data: [
    { tenantId: T, userId: patron.id, canal: "mcp", format: "json", lignes: QUOTA_EXTRACTION_JOUR - 3000 },
    { tenantId: T, userId: patron.id, canal: "liaison", format: "json", lignes: 1000 },
  ] });
  // Le premier qui prend le verrou de l'espace a le reste du jour ; l'autre, rien.
  const deux = await Promise.all([reserverExport(a, 5000).catch((e: unknown) => e), reserverExport(a, 5000).catch((e: unknown) => e)]);
  const servis = deux.filter((r): r is Awaited<ReturnType<typeof reserverExport>> => !(r instanceof Error));
  expect(servis).toHaveLength(1);
  expect(deux.filter((r) => r instanceof RefusExtraction)).toHaveLength(1);
  const x = servis[0];
  expect(x.taille).toBe(2000);
  await x.ajuster(1500); // servi moins que réservé : le reste revient
  const z = await reserverExport(a, 5000);
  expect(z.taille).toBe(500);
  await expect(reserverExport(a, 5000)).rejects.toBeInstanceOf(RefusExtraction);
  await z.annuler();
  expect((await reserverExport(a, 5000)).taille).toBe(500);
  const somme = await prisma.atlasExport.aggregate({ _sum: { lignes: true }, where: { tenantId: T } });
  expect(somme._sum.lignes).toBe(QUOTA_EXTRACTION_JOUR);
  await prisma.atlasExport.deleteMany({ where: { tenantId: T } });
});
