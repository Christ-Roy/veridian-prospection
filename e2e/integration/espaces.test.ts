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
