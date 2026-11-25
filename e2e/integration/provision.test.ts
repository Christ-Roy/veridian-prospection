/** Ouverture d'un espace par le Hub (VER-263) : complet d'un coup, rejouable, honnête. Vraie route, vraie signature, vraie base. Exige DATABASE_URL. */
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, expect, test, vi } from "vitest";

const SECRET = vi.hoisted(() => {
  Object.assign(process.env, { APP_URL: "http://localhost:3000", AUTH_SECRET: "secret-de-session-epreuve-0123456789" });
  return (process.env.HUB_API_SECRET = "secret-epreuve-provision-0123456789ab");
});
vi.mock("@/lib/auth-config", () => ({ auth: async () => null }));
const panne = vi.hoisted(() => ({ cle: false }));
vi.mock("@/lib/hub/apiKey", async (o) => {
  const vrai = await o<typeof import("@/lib/hub/apiKey")>();
  return { ...vrai, hashApiKey: (k: string) => { if (panne.cle) throw new Error("panne simulée"); return vrai.hashApiKey(k); } };
});

import { GET as ouvrirSession } from "@/app/api/auth/token/route";
import { POST } from "@/app/api/tenants/provision/route";
import { GET as parEmail } from "@/app/api/users/by-email/route";
import { planLocal } from "@/lib/hub/ouvrir-espace";
import { prisma } from "@/lib/prisma";

const vus: string[] = [];
let hub: string, org: string, email: string;
const signe = (c: string) => {
  const ts = String(Date.now());
  return { "content-type": "application/json", "x-veridian-timestamp": ts, "x-veridian-hub-signature": createHmac("sha256", SECRET).update(`${ts}.${c}`).digest("hex") };
};
async function ouvrir(o: Record<string, unknown> = {}) {
  const c = JSON.stringify({ email, user_id: hub, hub_tenant_id: org, plan: "freemium", name: "Boulangerie Martin", email_proven: true, ...o });
  const r = await POST(new NextRequest("https://x/api/tenants/provision", { method: "POST", body: c, headers: signe(c) }));
  return { s: r.status, j: (await r.json()) as Record<string, never> & Record<string, unknown> };
}
const etat = async () => {
  const u = (await prisma.user.findMany({ where: { email }, select: { id: true } })).map((x) => x.id);
  return { users: u.length, tenants: await prisma.tenant.count({ where: { userId: { in: u } } }) };
};
beforeEach(() => {
  vi.restoreAllMocks();
  hub = randomUUID();
  org = randomUUID();
  email = `ouv-${randomUUID().slice(0, 8)}@exemple.invalid`;
  vus.push(email);
});
afterAll(async () => {
  const u = (await prisma.user.findMany({ where: { email: { in: vus } }, select: { id: true } })).map((x) => x.id);
  const t = (await prisma.tenant.findMany({ where: { userId: { in: u } }, select: { id: true } })).map((x) => x.id);
  await prisma.ssoLoginToken.deleteMany({ where: { userId: { in: u } } });
  await prisma.workspaceMember.deleteMany({ where: { userId: { in: u } } });
  await prisma.workspace.deleteMany({ where: { tenantId: { in: t } } });
  await prisma.tenant.deleteMany({ where: { id: { in: t } } });
  await prisma.user.deleteMany({ where: { id: { in: u } } });
  await prisma.$disconnect();
});

test("neuf : tout d'un coup, rendu tel que la base le montre, et le Hub le relit par by-email", async () => {
  const r = await ouvrir({ plan: "pro" });
  expect(r).toMatchObject({ s: 200, j: { created: true, cree: { compte: true, espace: true, atelier: true, membre: true, lien: true }, plan: "pro", role: "admin", status: "active", hub_tenant_id: org, name: "Boulangerie Martin", api_key_minted: true } });
  expect(await prisma.tenant.findUniqueOrThrow({ where: { id: r.j.tenant_id as string } })).toMatchObject({ plan: "pro", hubTenantId: org, status: "active" });
  const q = await parEmail(new NextRequest(`https://x/api/users/by-email?email=${encodeURIComponent(email)}`, { headers: signe("") }));
  expect(await q.json()).toMatchObject({ found: true, workspaces: [expect.objectContaining({ hub_tenant_id: org, plan: "pro" })] });
  const s = await ouvrirSession(new NextRequest(r.j.login_url as string));
  expect(s.headers.getSetCookie().join()).toContain("session-token=");
});
test("rejoué : rien de plus, rien de changé, ni le plan ni le rôle ni le nom", async () => {
  const a = await ouvrir();
  await prisma.tenant.update({ where: { id: a.j.tenant_id as string }, data: { plan: "business", name: "Nom choisi" } });
  await prisma.workspaceMember.updateMany({ where: { workspaceId: a.j.workspace_id as string }, data: { role: "viewer" } });
  const b = await ouvrir({ plan: "free" });
  expect(b).toMatchObject({ s: 200, j: { created: false, cree: { compte: false, espace: false, atelier: false, membre: false, lien: false }, plan: "business", role: "viewer", name: "Nom choisi", tenant_id: a.j.tenant_id, workspace_id: a.j.workspace_id, api_key_minted: false } });
  expect(await etat()).toEqual({ users: 1, tenants: 1 });
});
test("huit ouvertures en même temps : un seul espace, un seul atelier", async () => {
  const r = await Promise.all(Array.from({ length: 8 }, () => ouvrir()));
  expect(r.map((x) => x.s)).toEqual(Array(8).fill(200));
  expect(new Set(r.map((x) => x.j.tenant_id)).size).toBe(1);
  expect(r.filter((x) => x.j.created).length).toBe(1);
  expect(await etat()).toEqual({ users: 1, tenants: 1 });
  expect(await prisma.workspace.count({ where: { tenantId: r[0].j.tenant_id as string } })).toBe(1);
});
test("une panne au milieu : échec dit, rien à moitié, et le rejeu aboutit", async () => {
  // Le dernier geste (la clé de l'atelier) échoue : ni compte, ni espace ne doivent rester.
  vi.spyOn(console, "error").mockImplementation(() => {});
  panne.cle = true;
  expect(await ouvrir()).toMatchObject({ s: 503, j: { error: "provision_failed", created: false } });
  panne.cle = false;
  expect(await etat()).toEqual({ users: 0, tenants: 0 });
  expect(await ouvrir()).toMatchObject({ s: 200, j: { created: true } });
});
test("ancien client dont l'espace est supprimé : même organisation = à restaurer, dit ; nouvelle = espace neuf, l'ancien intact", async () => {
  const a = await ouvrir();
  await prisma.tenant.update({ where: { id: a.j.tenant_id as string }, data: { deletedAt: new Date() } });
  expect(await ouvrir()).toMatchObject({ s: 409, j: { error: "tenant_soft_deleted", tenant_id: a.j.tenant_id, created: false } });
  const neuf = randomUUID();
  const b = await ouvrir({ hub_tenant_id: neuf });
  expect(b).toMatchObject({ s: 200, j: { created: true, hub_tenant_id: neuf } });
  expect(b.j.tenant_id).not.toBe(a.j.tenant_id);
  expect((await prisma.tenant.findUniqueOrThrow({ where: { id: a.j.tenant_id as string } })).deletedAt).not.toBeNull();
});
test("espace d'avant le lien : adopté et relié, pas doublé", async () => {
  const u = await prisma.user.create({ data: { email, hubUserId: hub } });
  const t = await prisma.tenant.create({ data: { userId: u.id, name: "Ancien", slug: `anc-${hub}`, plan: "pro", status: "active" } });
  expect(await ouvrir()).toMatchObject({ s: 200, j: { tenant_id: t.id, hub_tenant_id: org, plan: "pro", created: false, cree: { lien: true, atelier: true, membre: true, espace: false } } });
});
test("refus nommés, rien d'écrit", async () => {
  const a = await ouvrir();
  expect(await ouvrir({ hub_tenant_id: randomUUID() })).toMatchObject({ s: 409, j: { error: "tenant_link_conflict", hub_tenant_id: org } });
  await prisma.tenant.update({ where: { id: a.j.tenant_id as string }, data: { status: "suspended" } });
  expect(await ouvrir()).toMatchObject({ s: 409, j: { error: "tenant_suspended" } });
  const voisin = email;
  email = `ouv-${randomUUID().slice(0, 8)}@exemple.invalid`;
  vus.push(email);
  hub = randomUUID();
  expect(await ouvrir()).toMatchObject({ s: 409, j: { error: "tenant_owned_by_other" } });
  expect(await etat()).toEqual({ users: 0, tenants: 0 });
  expect(await ouvrir({ email: voisin, hub_tenant_id: randomUUID() })).toMatchObject({ s: 409, j: { error: "email_not_linkable" } });
  for (const [o, code] of [[{ user_id: undefined }, "hub_user_id_required"], [{ user_id: "x" }, "hub_user_id_required"], [{ email: "pas une adresse" }, "email_required"], [{ plan: "platine" }, "invalid_plan"], [{ hub_tenant_id: "mon-espace" }, "invalid_payload"]] as const)
    expect([code, await ouvrir({ ...o })]).toEqual([code, expect.objectContaining({ s: 400, j: expect.objectContaining({ error: code, created: false }) })]);
  expect(await etat()).toEqual({ users: 0, tenants: 0 });
});
test("adresse non prouvée : un compte local existant ne se laisse pas prendre ; un compte supprimé ne rouvre pas", async () => {
  await prisma.user.create({ data: { email } });
  expect(await ouvrir({ email_proven: false })).toMatchObject({ s: 409, j: { error: "email_not_linkable" } });
  expect(await ouvrir()).toMatchObject({ s: 200 });
  await prisma.user.updateMany({ where: { email }, data: { deletedAt: new Date() } });
  expect(await ouvrir()).toMatchObject({ s: 409, j: { error: "user_deleted" } });
});
test("l'adresse en majuscules désigne la même personne", async () => {
  const a = await ouvrir({ email: email.toUpperCase() });
  expect(await ouvrir()).toMatchObject({ s: 200, j: { tenant_id: a.j.tenant_id, created: false } });
});
test("plans", () => expect(["freemium", "free", undefined, "pro", "business", "enterprise", "platine", "Pro"].map(planLocal)).toEqual(["freemium", "freemium", "freemium", "pro", "business", "business", null, null]));
