/**
 * Administrateur de plateforme (CONTRAT-HUB §5.23, VER-263) sur vraie base : non signé 401 ; propriétaire 409 is_owner ; non membre,
 * inconnu, espace absent 404 ; grant pose admin (jamais owner), relu par GET ; le client le rétrograde = retrait : grant et sync-member
 * rendent 409 admin_withdrawn, seul reinstate le remet ; revoke ; une adresse dans le corps = 400. Signé comme le Hub (v2). Exige DATABASE_URL.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const SECRET = vi.hoisted(() => (process.env.HUB_API_SECRET = "secret-epreuve-admins-plateforme-0123456789"));

import { GET, POST } from "@/app/api/hub/workspace-admins/route";
import { POST as syncMember } from "@/app/api/tenants/[id]/sync-member/route";
import { prisma } from "@/lib/prisma";

const BASE = "https://prospection.app.veridian.site";
const crees: { u: string[]; t: string[] } = { u: [], t: [] };
type U = { id: string; hub: string; email: string };
let patron: U, admin: U, etranger: U, T: string, HUB_T: string, W: string;

let n = 0;
function signee(methode: "GET" | "POST", url: string, corps = "") {
  const ts = String(Date.now() + n++);
  const u = new URL(url);
  const sig = createHmac("sha256", SECRET).update([ts, methode, u.pathname, u.search.slice(1), createHash("sha256").update(corps).digest("hex")].join("\n")).digest("hex");
  return new NextRequest(url, { method: methode, headers: { "x-veridian-timestamp": ts, "x-veridian-hub-signature": sig, "x-veridian-sig-version": "2", "content-type": "application/json" }, ...(methode === "POST" ? { body: corps } : {}) });
}
const designer = async (corps: Record<string, unknown>) => {
  const r = await POST(signee("POST", `${BASE}/api/hub/workspace-admins`, JSON.stringify({ workspace_id: HUB_T, action: "grant", actor_hub_user_id: "cle:ADMIN_SECRET", reason: "épreuve", reinstate: false, ...corps })));
  return { s: r.status, j: await r.json() };
};
const lire = async (ws = HUB_T) => {
  const r = await GET(signee("GET", `${BASE}/api/hub/workspace-admins?workspace_id=${ws}`));
  return { s: r.status, j: await r.json() };
};
const membreDe = async (u: U) => ((await lire()).j.members as { hub_user_id: string }[]).find((m) => m.hub_user_id === u.hub);

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const id = randomUUID().slice(0, 8);
  const u = async (nom: string): Promise<U> => {
    const hub = randomUUID();
    const email = `adm-${nom}-${id}@exemple.invalid`;
    const r = await prisma.user.create({ data: { email, hubUserId: hub } });
    crees.u.push(r.id);
    return { id: r.id, hub, email };
  };
  patron = await u("patron");
  admin = await u("admin");
  etranger = await u("etranger");
  HUB_T = randomUUID();
  T = (await prisma.tenant.create({ data: { userId: patron.id, name: "Admins", slug: `adm-${id}`, plan: "pro", status: "active", hubTenantId: HUB_T } })).id;
  crees.t.push(T);
  W = (await prisma.workspace.create({ data: { tenantId: T, name: "W", slug: "default" } })).id;
  await prisma.workspaceMember.create({ data: { workspaceId: W, userId: patron.id, role: "owner" } });
  await prisma.workspaceMember.create({ data: { workspaceId: W, userId: admin.id, role: "member" } });
});
afterAll(async () => {
  await prisma.adminPlateforme.deleteMany({ where: { tenantId: { in: crees.t } } });
  await prisma.workspaceMember.deleteMany({ where: { workspace: { tenantId: { in: crees.t } } } });
  await prisma.workspace.deleteMany({ where: { tenantId: { in: crees.t } } });
  await prisma.tenant.deleteMany({ where: { id: { in: crees.t } } });
  await prisma.user.deleteMany({ where: { id: { in: crees.u } } });
  await prisma.compteur.deleteMany({ where: { cle: { startsWith: "hub-sig:" } } });
  await prisma.$disconnect();
});

test("non signé : 401, en POST comme en GET", async () => {
  const corps = JSON.stringify({ workspace_id: HUB_T, hub_user_id: admin.hub, action: "grant", actor_hub_user_id: "cle:X" });
  expect((await POST(new NextRequest(`${BASE}/api/hub/workspace-admins`, { method: "POST", body: corps, headers: { "content-type": "application/json" } }))).status).toBe(401);
  expect((await GET(new NextRequest(`${BASE}/api/hub/workspace-admins?workspace_id=${HUB_T}`))).status).toBe(401);
});

test("refus nommés : propriétaire, non membre, inconnu, espace absent, adresse dans le corps", async () => {
  expect(await designer({ hub_user_id: patron.hub })).toEqual({ s: 409, j: { error: "is_owner" } });
  expect(await designer({ hub_user_id: etranger.hub })).toEqual({ s: 404, j: { error: "not_a_member" } });
  expect(await designer({ hub_user_id: randomUUID() })).toEqual({ s: 404, j: { error: "user_not_in_app" } });
  expect(await designer({ hub_user_id: admin.hub, workspace_id: randomUUID() })).toEqual({ s: 404, j: { error: "tenant_not_found" } });
  expect((await designer({ hub_user_id: admin.hub, email: admin.email })).s).toBe(400);
  expect((await prisma.workspaceMember.findFirstOrThrow({ where: { userId: admin.id } })).role).toBe("member");
});

test("grant pose admin, jamais propriétaire ; relu par le Hub, par son id ou l'id local", async () => {
  expect(await designer({ hub_user_id: admin.hub })).toEqual({ s: 200, j: { member: { hub_user_id: admin.hub, role: "admin", admin_granted: true, admin_withdrawn: false } } });
  expect(await membreDe(admin)).toEqual({ hub_user_id: admin.hub, role: "admin", admin_granted: true, admin_withdrawn: false });
  expect(await membreDe(patron)).toMatchObject({ role: "owner", admin_granted: false });
  expect((await lire(T)).j.members).toHaveLength(2);
  expect(await designer({ hub_user_id: admin.hub })).toMatchObject({ s: 200 });
  expect((await prisma.tenant.findUniqueOrThrow({ where: { id: T } })).userId).toBe(patron.id);
});

test("le client le rétrograde : retrait gardé ; grant et sync-member 409 admin_withdrawn ; reinstate seul le remet", async () => {
  await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: W, userId: admin.id } }, data: { role: "member" } });
  expect(await membreDe(admin)).toMatchObject({ role: "member", admin_granted: true, admin_withdrawn: true });
  expect(await designer({ hub_user_id: admin.hub })).toEqual({ s: 409, j: { error: "admin_withdrawn" } });
  const corps = JSON.stringify({ user_email: admin.email, hub_user_id: admin.hub, email_proven: true, role: "admin" });
  const sync = await syncMember(signee("POST", `${BASE}/api/tenants/${T}/sync-member`, corps), { params: Promise.resolve({ id: T }) });
  expect([sync.status, await sync.json()]).toEqual([409, { error: "admin_withdrawn" }]);
  expect((await prisma.workspaceMember.findFirstOrThrow({ where: { userId: admin.id } })).role).toBe("member");
  expect(await designer({ hub_user_id: admin.hub, reinstate: true })).toMatchObject({ s: 200, j: { member: { role: "admin", admin_withdrawn: false } } });
});

test("revoke : redevient membre, et la désignation vaut retrait", async () => {
  expect(await designer({ hub_user_id: admin.hub, action: "revoke" })).toMatchObject({ s: 200, j: { member: { role: "member", admin_withdrawn: true } } });
  expect(await designer({ hub_user_id: admin.hub })).toEqual({ s: 409, j: { error: "admin_withdrawn" } });
  expect(await designer({ hub_user_id: patron.hub, action: "revoke" })).toEqual({ s: 409, j: { error: "is_owner" } });
});
