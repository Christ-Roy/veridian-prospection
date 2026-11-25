/**
 * Actions offertes aux autres apps (docs/LIAISONS.md) : vrais jetons ES256, vraie route, vraie base. Exige DATABASE_URL.
 */
import { randomUUID, webcrypto } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, { ATLAS_SIMULE: "1", HUB_MCP_ISSUER: "https://hub.test", HUB_JWKS_URL: "https://hub.test/jwks", MCP_PUBLIC_URL: "https://prospection.test/api/mcp" });
});
vi.mock("@/lib/auth-config", () => ({ auth: async () => null }));

import { POST } from "@/app/api/veridian/actions/[action]/route";
import { POST as mcp } from "@/app/api/mcp/route";
import { lireRecherche } from "@/atlas/actions";
import { QUOTA_EXTRACTION_JOUR } from "@/atlas/extraction";
import { sourceMarche } from "@/atlas/source";
import { invalidateAllUserContexts } from "@/lib/auth/cache-contexte";
import { _viderCacheJwks } from "@/lib/mcp/jeton-hub";
import { prisma } from "@/lib/prisma";

const id = randomUUID().slice(0, 8);
let cle: CryptoKey, autre: CryptoKey;
const kid = "k1";
const T: Record<string, { t: string; hub: string; u: string; hubUser: string; w: string }> = {};
let siren: string;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jeton(o: Record<string, unknown> = {}, k = cle) {
  const s = Math.floor(Date.now() / 1000);
  const c = { iss: "https://hub.test", aud: "https://prospection.test/api/veridian/actions", sub: T.payant.hubUser, email: "x@exemple.invalid", email_verified: true, scope: "prospection:entreprise.lire", tenant_id: T.payant.hub, act: { sub: "app:crm" }, jti: randomUUID(), iat: s, exp: s + 120, ...o };
  const tete = `${b64({ alg: "ES256", kid })}.${b64(c)}`;
  return `${tete}.${Buffer.from(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, Buffer.from(tete))).toString("base64url")}`;
}
async function appel(action: string, corps: unknown, o: { j?: string; cle?: string | null; claims?: Record<string, unknown> } = {}) {
  const h: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${o.j ?? (await jeton(o.claims))}` };
  if (o.cle !== null) h["idempotency-key"] = o.cle ?? randomUUID();
  const r = await POST(new NextRequest(`https://x/api/veridian/actions/${action}`, { method: "POST", headers: h, body: typeof corps === "string" ? corps : JSON.stringify(corps) }), { params: Promise.resolve({ action }) });
  return { s: r.status, ...(await r.json()) } as { s: number; error?: string; rejoue?: boolean; resultat?: Record<string, never> & Record<string, unknown> };
}
const exports_ = (t: string) => prisma.atlasExport.count({ where: { tenantId: t } });

beforeAll(async () => {
  const p = async () => webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const a = await p();
  cle = a.privateKey;
  autre = (await p()).privateKey;
  const pub = await webcrypto.subtle.exportKey("jwk", a.publicKey);
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ keys: [{ ...pub, kid: "k1", alg: "ES256", use: "sig" }] })));
  for (const [n, plan] of [["payant", "pro"], ["gratuit", "freemium"]] as const) {
    const hubUser = randomUUID(), hub = randomUUID();
    const u = await prisma.user.create({ data: { email: `act-${n}-${id}@exemple.invalid`, hubUserId: hubUser } });
    const t = await prisma.tenant.create({ data: { userId: u.id, name: n, slug: `act-${n}-${id}`, plan, status: "active", hubTenantId: hub } });
    const w = await prisma.workspace.create({ data: { tenantId: t.id, name: "W", slug: "default" } });
    await prisma.workspaceMember.create({ data: { workspaceId: w.id, userId: u.id, role: "admin" } });
    T[n] = { t: t.id, hub, u: u.id, hubUser, w: w.id };
  }
  siren = (await sourceMarche().extraire(Array.from({ length: 3000 }, (_, i) => String(900000000 + i))))[0].siren; // une fiche simulée qui a un email
});
beforeEach(() => { _viderCacheJwks(); invalidateAllUserContexts(); });
afterAll(async () => {
  const t = Object.values(T).map((x) => x.t);
  await prisma.atlasExport.deleteMany({ where: { tenantId: { in: t } } });
  await prisma.atlasEnvoi.deleteMany({ where: { tenantId: { in: t } } });
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: Object.values(T).map((x) => x.w) } } });
  await prisma.workspace.deleteMany({ where: { tenantId: { in: t } } });
  await prisma.tenant.deleteMany({ where: { id: { in: t } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(T).map((x) => x.u) } } });
  await prisma.$disconnect();
});

describe("chercher", () => {
  test("par SIREN : l'entreprise, sans aucune coordonnée, même en plan payant", async () => {
    const r = await appel("entreprises.chercher", { q: siren }, { cle: null });
    expect([r.s, (r.resultat!.entreprises as { siren: string }[])[0].siren]).toEqual([200, siren]);
    expect(JSON.stringify(r)).not.toMatch(/@|email|telephone/i);
    expect(await exports_(T.payant.t)).toBe(0);
  });
  test("ce qui se cherche : SIREN, SIRET, domaine, sinon les mots du nom", () => {
    expect(lireRecherche("552 032 534")).toEqual({ siren: "552032534" });
    expect(lireRecherche("55203253400646")).toEqual({ siren: "552032534" });
    expect(lireRecherche("https://www.Michelin.fr/pneus")).toEqual({ domaine: "michelin.fr" });
    expect(lireRecherche("SARL Élevage du Père Noël")).toEqual({ mots: ["elevage", "pere", "noel"] });
    expect(() => lireRecherche("la sarl")).toThrow("demande_invalide");
  });
  test("rien d'inventé : inconnu = liste vide ; corps refusé", async () => {
    expect((await appel("entreprises.chercher", { q: "999999999" })).resultat).toEqual({ entreprises: [] });
    for (const c of [{}, { q: "a" }, { q: "ok", limite: 500 }, { q: "ok", tenant_id: T.gratuit.hub }, "pas du json"]) expect((await appel("entreprises.chercher", c)).error).toBe("demande_invalide");
  });
});

describe("enrichir", () => {
  test("payant : coordonnées jointes, comptées et tracées une fois ; un rejeu ne recompte pas et rien n'est gardé", async () => {
    const k = randomUUID();
    const a = await appel("entreprises.enrichir", { siren }, { cle: k });
    expect(a).toMatchObject({ s: 200, rejoue: false, resultat: { siren, prospectable: true, coordonnees: "jointes", contact: { email: expect.stringContaining("@") } } });
    const b = await appel("entreprises.enrichir", { siren }, { cle: k });
    expect(b).toMatchObject({ s: 200, rejoue: true, resultat: { contact: (a.resultat as Record<string, unknown>).contact } });
    expect(await exports_(T.payant.t)).toBe(1);
    expect(JSON.stringify(await prisma.atlasEnvoi.findMany({ where: { tenantId: T.payant.t } }))).not.toContain("@");
    expect((await appel("entreprises.enrichir", { siren: "999999998" }, { cle: k })).error).not.toBeUndefined();
  });
  test("gratuit : l'identité, jamais une coordonnée, rien de compté", async () => {
    const r = await appel("entreprises.enrichir", { siren }, { claims: { sub: T.gratuit.hubUser, tenant_id: T.gratuit.hub } });
    expect(r).toMatchObject({ s: 200, resultat: { coordonnees: "plan", nom: expect.any(String) } });
    expect(JSON.stringify(r)).not.toContain("@");
    expect(await exports_(T.gratuit.t)).toBe(0);
  });
  test("non prospectable : identité publique seule ; inconnue : 404", async () => {
    const s = sourceMarche();
    const v = vi.spyOn(s, "pourCrm").mockResolvedValue(null);
    const r = await appel("entreprises.enrichir", { siren });
    expect(r).toMatchObject({ s: 200, resultat: { prospectable: false, coordonnees: "non_prospectable" } });
    expect(JSON.stringify(r)).not.toMatch(/@|dirigeant/);
    v.mockRestore();
    expect(await appel("entreprises.enrichir", { siren: "999999999" })).toMatchObject({ s: 404, error: "entreprise_inconnue" });
  });
  test("plafond du jour atteint : refus dit, sans coordonnée", async () => {
    const x = await prisma.atlasExport.create({ data: { tenantId: T.payant.t, userId: T.payant.u, canal: "liaison", format: "json", lignes: QUOTA_EXTRACTION_JOUR } });
    const r = await appel("entreprises.enrichir", { siren });
    expect(r).toMatchObject({ s: 429, error: "quota" });
    expect(JSON.stringify(r)).not.toContain("@");
    await prisma.atlasExport.delete({ where: { id: x.id } });
  });
  test("clé d'idempotence exigée ; la même pour un autre SIREN est refusée", async () => {
    for (const c of [null, "court"]) expect(await appel("entreprises.enrichir", { siren }, { cle: c })).toMatchObject({ s: 400, error: "cle_requise" });
    const k = randomUUID();
    await appel("entreprises.enrichir", { siren }, { cle: k });
    const v = vi.spyOn(sourceMarche(), "pourCrm").mockResolvedValue({ siren: "888888888", email: "a@b.invalid", telephone: null } as never);
    const f = vi.spyOn(sourceMarche(), "fiche").mockResolvedValue({ identite: { nom: "X" } } as never);
    expect(await appel("entreprises.enrichir", { siren: "888888888" }, { cle: k })).toMatchObject({ s: 422, error: "cle_reutilisee" });
    v.mockRestore();
    f.mockRestore();
  });
});

describe("la garde", () => {
  const s = () => Math.floor(Date.now() / 1000);
  test("jeton refusé : signature, audience, acteur, durée, sujet, organisation, identifiant", async () => {
    const mauvais: [string, Record<string, unknown>][] = [
      ["audience MCP", { aud: "https://prospection.test/api/mcp" }], ["audience autre app", { aud: "https://notifuse.test/api/veridian/actions" }], ["sans acteur", { act: undefined }],
      ["acteur forgé", { act: { sub: "crm" } }], ["chaîne d'acteurs", { act: { sub: "app:crm", act: { sub: "app:x" } } }], ["trop long", { exp: s() + 3600 }], ["expiré", { iat: s() - 200, exp: s() - 80 }], ["expiré dans la tolérance", { iat: s() - 120, exp: s() - 5 }],
      ["sans jti", { jti: undefined }], ["sans organisation", { tenant_id: undefined }], ["autre émetteur", { iss: "https://mechant.test" }], ["adresse non prouvée", { email_verified: false }], ["sujet d'intégration", { sub: `integration:${T.payant.hub}` }],
    ];
    for (const [nom, c] of mauvais) expect([nom, (await appel("entreprises.chercher", { q: siren }, { claims: c })).error]).toEqual([nom, "jeton_refuse"]);
    expect((await appel("entreprises.chercher", { q: siren }, { j: await jeton({}, autre) })).error).toBe("jeton_refuse");
    expect((await appel("entreprises.chercher", { q: siren }, { j: "x" })).error).toBe("jeton_refuse");
  });
  test("un jeton ne sert qu'une fois, même refusé la première", async () => {
    const j = await jeton(), k = await jeton();
    expect((await appel("entreprises.chercher", { q: siren }, { j })).s).toBe(200);
    expect(await appel("entreprises.chercher", { q: siren }, { j })).toMatchObject({ s: 401, error: "jeton_deja_vu" });
    expect((await appel("nexiste.pas", {}, { j: k })).error).toBe("action_inconnue");
    expect((await appel("entreprises.chercher", { q: siren }, { j: k })).error).toBe("jeton_deja_vu");
    const deux = await jeton();
    expect((await Promise.all([1, 2, 3].map(() => appel("entreprises.chercher", { q: siren }, { j: deux })))).map((r) => r.s).sort()).toEqual([200, 401, 401]);
  });
  test("portée, app, utilisateur, organisation, retrait, gel, suspension", async () => {
    const c = async (claims: Record<string, unknown>) => (await appel("entreprises.chercher", { q: siren }, { claims })).error;
    expect(await c({ scope: "prospection:exclusion.ecrire" })).toBe("portee_insuffisante");
    expect(await c({ scope: "veridian" })).toBe("portee_insuffisante");
    expect(await c({ act: { sub: "app:notifuse" } })).toBe("app_non_autorisee");
    expect(await c({ sub: randomUUID() })).toBe("utilisateur_inconnu");
    expect(await c({ tenant_id: randomUUID() })).toBe("espace_non_relie");
    expect(await c({ tenant_id: T.gratuit.hub })).toBe("non_membre");
    await prisma.workspaceMember.updateMany({ where: { userId: T.payant.u }, data: { frozenAt: new Date() } });
    expect(await c({})).toBe("espace_suspendu");
    await prisma.workspaceMember.updateMany({ where: { userId: T.payant.u }, data: { frozenAt: null } });
    await prisma.tenant.update({ where: { id: T.payant.t }, data: { status: "suspended" } });
    expect(await c({})).toBe("espace_suspendu");
    await prisma.tenant.update({ where: { id: T.payant.t }, data: { status: "active" } });
    expect(await c({})).toBeUndefined();
  });
  test("un jeton d'action n'ouvre pas le MCP, même adressé au MCP", async () => {
    const r = await mcp(new NextRequest("https://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${await jeton({ aud: "https://prospection.test/api/mcp" })}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
    expect([r.status, JSON.stringify(await r.json())]).toEqual([401, expect.stringContaining("jeton d'action")]);
  });
});
