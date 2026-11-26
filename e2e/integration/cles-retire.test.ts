/**
 * Clés `atl_` : elles agissent au nom de leur créateur, donc tombent avec lui. Retiré de l'espace, compte supprimé, gelé, espace
 * suspendu ou sans accès avancé : refus immédiat. Remis dans l'espace : la clé ne revient pas. Exige DATABASE_URL.
 */
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, expect, test, vi } from "vitest";

const SECRET = vi.hoisted(() => {
  process.env.ATLAS_SIMULE = "1";
  return (process.env.HUB_API_SECRET = "secret-epreuve-cles-0123456789abcdef");
});
vi.mock("@/lib/auth-config", () => ({ auth: async () => null }));

import { contexteDepuisCle, creerCle, oublierDroits } from "@/atlas/acces";
import { POST as outil } from "@/app/api/atlas/[outil]/route";
import { POST as sync } from "@/app/api/hub/users/sync/route";
import { POST as retirer } from "@/app/api/tenants/[id]/remove-member/route";
import { invalidateAllUserContexts } from "@/lib/auth/cache-contexte";
import { prisma } from "@/lib/prisma";

const crees: { u: string[]; t: string[] } = { u: [], t: [] };
let patron: { id: string; hub: string }, membre: { id: string; hub: string }, T: string, W: string, cle: string, temoin: string;

const signe = (url: string, corps: object) => {
  const brut = JSON.stringify(corps), ts = String(Date.now());
  return new NextRequest(url, { method: "POST", body: brut, headers: { "content-type": "application/json", "x-veridian-timestamp": ts, "x-veridian-hub-signature": createHmac("sha256", SECRET).update(`${ts}.${brut}`).digest("hex") } });
};
const appel = async (c: string) => (await outil(new NextRequest("https://x/api/atlas/mes_droits", { method: "POST", body: "{}", headers: { authorization: `Bearer ${c}` } }), { params: Promise.resolve({ outil: "mes_droits" }) })).status;

beforeEach(async () => {
  const id = randomUUID().slice(0, 8);
  const u = async (n: string) => {
    const hub = randomUUID();
    const r = await prisma.user.create({ data: { email: `cle-${n}-${id}@exemple.invalid`, hubUserId: hub } });
    crees.u.push(r.id);
    return { id: r.id, hub };
  };
  patron = await u("patron");
  membre = await u("membre");
  T = (await prisma.tenant.create({ data: { userId: patron.id, name: "Clés", slug: `cles-${id}`, plan: "pro", accesAvance: true, status: "active" } })).id;
  crees.t.push(T);
  W = (await prisma.workspace.create({ data: { tenantId: T, name: "W", slug: "default" } })).id;
  for (const m of [patron, membre]) await prisma.workspaceMember.create({ data: { workspaceId: W, userId: m.id, role: "admin" } });
  oublierDroits();
  invalidateAllUserContexts();
  cle = (await creerCle({ userId: membre.id, tenantId: T }, "script du membre")).cle;
  temoin = (await creerCle({ userId: patron.id, tenantId: T }, "témoin")).cle;
  expect([await appel(cle), await appel(temoin)]).toEqual([200, 200]);
});
afterAll(async () => {
  await prisma.atlasCleApi.deleteMany({ where: { tenantId: { in: crees.t } } });
  await prisma.workspaceMember.deleteMany({ where: { workspace: { tenantId: { in: crees.t } } } });
  await prisma.workspace.deleteMany({ where: { tenantId: { in: crees.t } } });
  await prisma.tenant.deleteMany({ where: { id: { in: crees.t } } });
  await prisma.user.deleteMany({ where: { id: { in: crees.u } } });
  await prisma.$disconnect();
});
const retrait = async () => (await retirer(signe(`https://x/api/tenants/${T}/remove-member`, { hub_user_id: membre.hub }), { params: Promise.resolve({ id: T }) })).json();

test("retiré : sa clé tombe à la lecture suivante, celle du témoin vit ; le Hub lit combien", async () => {
  // Le Hub dit à l'auteur du geste combien de clés de l'espace restent actives (avisCles) : ici celle du témoin.
  expect(await retrait()).toMatchObject({ removed: true, revoked_api_keys: 1, active_api_keys: 1, active_api_keys_created_by_member: 0, api_keys_url: expect.stringMatching(/^https?:\/\//) });
  expect([await appel(cle), await appel(temoin)]).toEqual([401, 200]);
  expect(await retrait()).toMatchObject({ removed: true, revoked_api_keys: 0, active_api_keys: 1 });
});
test("remis dans l'espace, la clé d'avant ne revient pas", async () => {
  await retrait();
  await prisma.workspaceMember.updateMany({ where: { userId: membre.id, workspaceId: W }, data: { deletedAt: null } });
  invalidateAllUserContexts();
  expect(await appel(cle)).toBe(401);
  expect(await appel((await creerCle({ userId: membre.id, tenantId: T }, "neuve")).cle)).toBe(200);
});
test("appartenance retirée sans passer par la route : la clé ne vaut plus, même non révoquée", async () => {
  // Il a son propre espace : la clé ne doit pas s'y rabattre.
  crees.t.push((await prisma.tenant.create({ data: { userId: membre.id, name: "Chez lui", slug: `chez-lui-${randomUUID().slice(0, 8)}`, plan: "pro", accesAvance: true, status: "active" } })).id);
  await prisma.workspaceMember.updateMany({ where: { userId: membre.id, workspaceId: W }, data: { deletedAt: new Date() } });
  invalidateAllUserContexts();
  expect([await appel(cle), await appel(temoin)]).toEqual([401, 200]);
});
test("compte supprimé au Hub : toutes ses clés, celles de l'espace dont il est propriétaire comprises", async () => {
  expect((await sync(signe("https://x/api/hub/users/sync", { hub_user_id: patron.hub, deleted: true }))).status).toBe(200);
  expect([await appel(temoin), await appel(cle)]).toEqual([401, 200]);
  expect(await prisma.atlasCleApi.count({ where: { userId: patron.id, revoqueeLe: null } })).toBe(0);
  await prisma.atlasCleApi.updateMany({ where: { userId: patron.id }, data: { revoqueeLe: null } });
  expect(await contexteDepuisCle(`Bearer ${temoin}`)).toBeNull();
});
test("couper ses sessions ne touche pas ses clés", async () => {
  expect((await sync(signe("https://x/api/hub/users/sync", { hub_user_id: membre.hub, revoke_sessions: true }))).status).toBe(200);
  expect(await appel(cle)).toBe(200);
});
test("gelé, espace suspendu, espace fermé, accès avancé retiré : refus, et la clé revient quand la cause part", async () => {
  await prisma.workspaceMember.updateMany({ where: { userId: membre.id }, data: { frozenAt: new Date() } });
  expect([await appel(cle), await appel(temoin)]).toEqual([401, 200]);
  await prisma.workspaceMember.updateMany({ where: { userId: membre.id }, data: { frozenAt: null } });
  expect(await appel(cle)).toBe(200);
  for (const coupe of [{ status: "suspended" as const }, { deletedAt: new Date() }]) {
    await prisma.tenant.update({ where: { id: T }, data: coupe });
    expect([await appel(cle), await appel(temoin)]).toEqual([401, 401]);
    await prisma.tenant.update({ where: { id: T }, data: { status: "active", deletedAt: null } });
    expect(await appel(cle)).toBe(200);
  }
  await prisma.tenant.update({ where: { id: T }, data: { accesAvance: false } });
  oublierDroits();
  expect(await appel(cle)).toBe(401);
});
