/**
 * Liaisons (VER-246) de bout en bout contre un Hub, un CRM et un Mail simulés sur de vrais serveurs HTTP, et une vraie
 * base PostgreSQL : rebond avec poignée, session, jeton d'action signé et à usage unique, envoi, rejeu, refus.
 * Les simulés appliquent le contrat (INTEGRATIONS-NATIVES §2.1 à 2.3) : ils refusent, ils n'approuvent pas tout.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "secret-de-session-epreuve-0123456789";
  process.env.HUB_API_SECRET = "secret-partage-hub-epreuve-0123456789";
  process.env.ATLAS_LIAISONS = "crm=*;notifuse=*";
});

const odh = vi.hoisted(() => ({ n: 0, bloques: new Set<string>() }));
vi.mock("@/atlas/source", async (o) => {
  const ligne = (siren: string) => ({
    siren, email: `contact@e${siren}.invalid`, domaine: `e${siren}.invalid`, raison_sociale: `SOCIETE ${siren}`, dirigeant: "CAROLE GABARROCA", role_dirigeant: "Gérant",
    activite: "Élevage", naf: "01.49Z", code_postal: "69001", commune: "LYON", departement: "69", telephone: "0400000000",
  });
  const tous = () => Array.from({ length: odh.n }, (_, i) => String(100000000 + i));
  return {
    ...(await o<typeof import("@/atlas/source")>()),
    sourceMarche: () => ({
      sirensEnvoyables: async (_f: unknown, _s: unknown, max: number) => ({ sirens: tous().slice(0, max), total: odh.n, version: "R1" }),
      extraire: async (s: string[]) => s.filter((x) => tous().includes(x) && !odh.bloques.has(x)).map(ligne),
      pourCrm: async (s: string) => (odh.bloques.has(s) ? null : ligne(s)),
    }),
  };
});

import { GET as ouvrirSession } from "@/app/api/auth/token/route";
import { POST as emettreLien } from "@/app/api/sso/issue-magic-link/route";
import type { UserContext } from "@/lib/auth/user-context";
import { sessionId } from "@/lib/liaisons/session";
import { poigneeDe } from "@/lib/liaisons/poignee";
import { prisma } from "@/lib/prisma";
import * as li from "@/atlas/liaisons";
import * as seg from "@/atlas/segments";

const SECRET = process.env.HUB_API_SECRET!;
const id = randomUUID().slice(0, 8);

// ---------------------------------------------------------------- les simulés

type Etat = { poignees: Map<string, { user: string; tenant: string }>; nonces: Set<string>; jetons: Map<string, { tenant: string; cible: string; scope: string }>; paire: Record<string, boolean>; forcer: null | { status: number; corps: unknown }; tenantRendu: string | null; etats: Record<string, string> | "panne"; demandes: { cible: string; motif: string; headers: IncomingMessage["headers"] }[] };
const hub: Etat = { poignees: new Map(), nonces: new Set(), jetons: new Map(), paire: {}, forcer: null, tenantRendu: null, etats: {}, demandes: [] };
const crm = { fiches: new Map<string, string>(), appels: 0, corbeille: new Set<string>(), tenants: new Set<string>(), panne: 0, lenteur: 0, oubli: false, droits: false, cles: [] as string[], sse: false };
const mail = { contacts: new Map<string, Record<string, unknown>>(), listes: new Map<string, string>(), appels: [] as { outil: string; args: Record<string, unknown>; cle: string }[], mails: 0, desinscrits: new Set<string>(), sequence: new Set<string>(), sautePage: 0, ment: "" as "" | "dry_run" | "http", tenants: new Set<string>() };

const lire = (r: IncomingMessage) => new Promise<string>((ok) => { let s = ""; r.on("data", (d) => (s += d)); r.on("end", () => ok(s)); });
const serveurs: Server[] = [];
async function servir(f: (r: IncomingMessage, corps: string) => { status: number; corps: unknown; entetes?: Record<string, string>; brut?: string }): Promise<string> {
  const s = createServer(async (req, res) => {
    const r = f(req, await lire(req));
    res.writeHead(r.status, { "Content-Type": "application/json", ...r.entetes }).end(r.brut ?? JSON.stringify(r.corps));
  });
  serveurs.push(s);
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
/** Un jeton ne sert qu'une fois, chez sa cible, avec sa portée. */
function jetonValable(r: IncomingMessage, cible: string) {
  const t = /^Bearer (.+)$/.exec(r.headers.authorization ?? "")?.[1] ?? "";
  const j = hub.jetons.get(t);
  if (!j || j.cible !== cible) return null;
  hub.jetons.delete(t);
  return j;
}
const outil = (v: unknown, erreur = false) => ({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(v) }], isError: erreur } });

const T: Record<string, { t: string; hub: string; u: string; hubUser: string; email: string; ctx: UserContext }> = {};

beforeAll(async () => {
  const urlCrm = await servir((req, corps) => {
    const j = jetonValable(req, "crm");
    if (!j) return { status: 401, corps: { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "token_replayed" } } };
    if (!crm.tenants.has(j.tenant)) return { status: 403, corps: { jsonrpc: "2.0", id: 1, error: { code: -32003, message: "x", data: { error: "tenant_not_linked" } } } };
    crm.appels++;
    crm.cles.push(String(req.headers["idempotency-key"]));
    if (crm.panne > 0) {
      crm.panne--;
      return { status: 500, corps: { error: "panne" } };
    }
    const { params } = JSON.parse(corps);
    if (params.name !== "app_envoyer_au_crm") return { status: 200, corps: outil({ error: "Tool not found" }, true) };
    const a = params.arguments;
    const un = (e: { siren: string }) => {
      if (crm.corbeille.has(e.siren)) return { ok: false, erreur: "corbeille", message: "Cette société est dans la corbeille du CRM." };
      const neuf = !crm.fiches.has(e.siren);
      crm.fiches.set(e.siren, j.tenant);
      return { ok: true, rejoue: !neuf, societe: { id: "x", etat: neuf ? "creee" : "inchangee", url: `https://banc.crm.app.veridian.site/object/company/${e.siren}` }, contact: null, tache: null };
    };
    let resultat: unknown;
    if (Array.isArray(a.envois)) {
      if (a.envois.length < 1 || a.envois.length > 20) resultat = { ok: false, erreur: "lot_invalide", message: "Un lot contient de 1 à 20 envois." };
      else {
        const l = a.envois.map((e: { siren: string }, i: number) => ({ siren: e.siren, ...(crm.lenteur > 0 && i >= 10 ? { ok: false, erreur: "non_traite", message: "Pas traité à temps" } : crm.droits ? { ok: false, erreur: "droits", message: "Votre rôle dans ce CRM ne permet pas cet envoi." } : un(e)) }));
        if (crm.lenteur > 0) crm.lenteur--;
        resultat = { ok: true, lot: true, reussis: l.length, total: l.length, resultats: crm.oubli ? l.slice(1) : l };
      }
    } else resultat = un(a);
    const r = outil({ result: resultat });
    return crm.sse ? { status: 200, corps: null, entetes: { "Content-Type": "text/event-stream" }, brut: `event: message\ndata: ${JSON.stringify(r)}\n\n` } : { status: 200, corps: r };
  });
  const urlMail = await servir((req, corps) => {
    const j = jetonValable(req, "notifuse");
    if (!j) return { status: 401, corps: { error: "jeton" } };
    const action = /^\/api\/veridian\/actions\/([a-z.]+)$/.exec(req.url ?? "")?.[1] ?? "";
    const a = JSON.parse(corps) as Record<string, unknown>;
    const cle = String(req.headers["idempotency-key"] ?? "");
    mail.appels.push({ outil: action, args: a, cle });
    if (j.scope !== "notifuse:contacts.ecrire") return { status: 403, corps: { error: "portee_insuffisante" } };
    if (!a.dry_run && (cle.length < 8 || cle.length > 128)) return { status: 400, corps: { error: "cle_requise" } };
    const fait = (resultat: unknown) => ({ status: 200, corps: { action, rejoue: false, simulation: !!a.dry_run, resultat } });
    if (action === "listes.lister") return fait(mail.ment === "http" ? { lists: null } : { lists: [...mail.listes].map(([id, name]) => ({ id, name, starts_sequence: mail.sequence.has(id) })) });
    if (action === "listes.creer") {
      mail.listes.set(String(a.id), String(a.name));
      return fait({ id: a.id, name: a.name, existait: false });
    }
    if (action !== "contacts.importer") return { status: 404, corps: { error: "action_inconnue" } };
    if (Object.keys(a).some((k) => !["list_ids", "contacts", "dry_run"].includes(k))) return { status: 400, corps: { error: "demande_invalide" } };
    const contacts = a.contacts as { email: string }[];
    if (contacts.length > 1000) return { status: 400, corps: { error: "trop" } };
    const liste = (a.list_ids as string[])[0];
    if (mail.sequence.has(liste) && !a.dry_run) return { status: 409, corps: { error: "refus_de_l_app", reason: "x", detail: { code: "would_trigger", error: "x" } } };
    if (!a.dry_run && mail.sautePage > 0 && --mail.sautePage === 0) return { status: 502, corps: { error: "coupure" } };
    let crees = 0, existants = 0, exclus = 0;
    for (const c of contacts) {
      if (mail.desinscrits.has(c.email)) exclus++;
      else if (mail.contacts.has(c.email)) existants++;
      else {
        crees++;
        if (!a.dry_run) mail.contacts.set(c.email, c);
      }
    }
    if (mail.ment === "http") return { status: 500, corps: { resultat: { dry_run: a.dry_run, received: 1, created: 1 } } };
    return fait({ dry_run: mail.ment === "dry_run" ? !a.dry_run : a.dry_run, received: contacts.length, created: crees, updated: 0, existing: existants, subscribed: a.dry_run ? 0 : crees, skipped: exclus ? { desinscrit: exclus } : {}, ...(mail.sequence.has(liste) ? { triggers: [{ id: "s", name: "Séquence" }] } : {}) });
  });
  process.env.HUB_API_URL = await servir((req, corps) => {
    const h = req.headers;
    if (!["/api/delegation/jeton", "/api/delegation/paires"].includes(req.url ?? "") || h["x-veridian-app"] !== "prospection") return { status: 404, corps: { error: "x" } };
    const ts = String(h["x-veridian-timestamp"]), nonce = String(h["x-veridian-nonce"]);
    const sig = createHmac("sha256", SECRET).update(`${ts}.${nonce}.${corps}`).digest("hex");
    if (sig !== h["x-veridian-hub-signature"] || Math.abs(Date.now() - Number(ts)) > 300_000 || !/^[0-9a-f]{32}$/.test(nonce) || hub.nonces.has(nonce)) return { status: 401, corps: { error: "invalid_signature" } };
    hub.nonces.add(nonce);
    const d = JSON.parse(corps);
    if (req.url === "/api/delegation/paires") {
      const p = hub.poignees.get(d.subject_grant);
      if (!p) return { status: 403, corps: { error: "grant_invalid" } };
      if (hub.etats === "panne") return { status: 500, corps: {} };
      return { status: 200, corps: { tenant_id: hub.tenantRendu ?? p.tenant, paires: Object.entries(hub.etats).map(([audience, etat]) => ({ audience, etat, portees: [] })) } };
    }
    hub.demandes.push({ cible: d.audience, motif: d.motif, headers: h });
    if (hub.forcer) return { status: hub.forcer.status, corps: hub.forcer.corps, entetes: { "Retry-After": "30" } };
    const p = hub.poignees.get(d.subject_grant);
    if (!p) return { status: 403, corps: { error: "grant_invalid" } };
    if (hub.paire[d.audience] === false) return { status: 403, corps: { error: "integration_off" } };
    if (d.audience === "crm" ? d.scope !== "crm:societe.ecrire crm:tache.ecrire" : d.scope !== "notifuse:contacts.ecrire") return { status: 403, corps: { error: "pair_not_allowed" } };
    const jeton = randomBytes(24).toString("base64url");
    hub.jetons.set(jeton, { tenant: p.tenant, cible: d.audience, scope: d.scope });
    return { status: 200, corps: { access_token: jeton, expires_in: 120, tenant_id: hub.tenantRendu ?? p.tenant, url: d.audience === "crm" ? `${urlCrm}/mcp` : `${urlMail}/api/veridian/actions` } };
  });

  for (const [nom, plan] of [["paye", "business"], ["gratuit", "freemium"], ["autre", "business"]]) {
    const hubUser = randomUUID(), hubTenant = randomUUID(), email = `liaison-${nom}-${id}@exemple.invalid`;
    const u = await prisma.user.create({ data: { email, hubUserId: hubUser } });
    const t = await prisma.tenant.create({ data: { userId: u.id, name: nom, slug: `liaison-${nom}-${id}`, plan, hubTenantId: hubTenant } });
    T[nom] = { t: t.id, hub: hubTenant, u: u.id, hubUser, email, ctx: { userId: u.id, email, tenantId: t.id, tenantOwnerId: u.id, workspaces: [], isAdmin: true, activeWorkspaceId: null } };
  }
});

const tenants = () => Object.values(T).map((x) => x.t);
beforeEach(async () => {
  await prisma.atlasEnvoi.deleteMany({ where: { tenantId: { in: tenants() } } });
  await prisma.atlasExport.deleteMany({ where: { tenantId: { in: tenants() } } });
  await prisma.atlasExtraction.deleteMany({ where: { tenantId: { in: tenants() } } });
  await prisma.sessionDelegation.deleteMany({ where: { userId: { in: Object.values(T).map((x) => x.u) } } });
  await prisma.compteur.deleteMany({ where: { cle: { in: Object.values(T).map((x) => `sso:issue-magic-link:${x.hubUser}`) } } });
  Object.assign(hub, { poignees: new Map(), jetons: new Map(), paire: {}, forcer: null, tenantRendu: null, etats: {}, demandes: [] });
  Object.assign(crm, { fiches: new Map(), appels: 0, corbeille: new Set(), tenants: new Set(Object.values(T).map((x) => x.hub)), panne: 0, lenteur: 0, oubli: false, droits: false, cles: [], sse: false });
  Object.assign(mail, { contacts: new Map(), listes: new Map([["reserve", "Réserve"]]), appels: [], desinscrits: new Set(), sequence: new Set(), sautePage: 0, ment: "" });
  odh.n = 45;
  odh.bloques.clear();
  process.env.ATLAS_LIAISONS = "crm=*;notifuse=*";
});
afterAll(async () => {
  await prisma.atlasEnvoi.deleteMany({ where: { tenantId: { in: tenants() } } });
  await prisma.atlasExport.deleteMany({ where: { tenantId: { in: tenants() } } });
  await prisma.atlasExtraction.deleteMany({ where: { tenantId: { in: tenants() } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(T).map((x) => x.u) } } }).catch(() => undefined);
  serveurs.forEach((s) => s.close());
  await prisma.$disconnect();
});

// ---------------------------------------------------------------- le parcours

/** Le rebond : le Hub émet un lien avec une poignée, le navigateur l'ouvre, on rend le cookie. */
async function rebond(nom: string, plus: Record<string, unknown> = {}, autres: unknown[] = []): Promise<{ cookie: string; poignee: string }> {
  const x = T[nom];
  const poignee = randomBytes(32).toString("base64url");
  hub.poignees.set(poignee, { user: x.hubUser, tenant: x.hub });
  const corps = JSON.stringify({ hub_user_id: x.hubUser, email: x.email, email_proven: true, delegations: [{ hub_tenant_id: x.hub, grant: poignee, expire_le: new Date(Date.now() + 3600_000).toISOString(), ...plus }, ...autres] });
  const ts = Date.now();
  const r = await emettreLien(new NextRequest("http://localhost:3000/api/sso/issue-magic-link", { method: "POST", body: corps, headers: { "content-type": "application/json", "x-veridian-timestamp": String(ts), "x-veridian-hub-signature": createHmac("sha256", SECRET).update(`${ts}.${corps}`).digest("hex") } }));
  expect(r.status).toBe(200);
  const lien = ((await r.json()) as { magic_link_url: string }).magic_link_url;
  const s = await ouvrirSession(new NextRequest(`http://localhost:3000/api/auth/token${new URL(lien).search}`));
  const c = s.cookies.getAll().find((k) => k.name.endsWith("session-token"));
  expect(c?.value).toBeTruthy();
  return { cookie: `${c!.name}=${c!.value}`, poignee };
}
const sid = (cookie: string) => sessionId(new NextRequest("http://localhost:3000/api/liaisons/etat", { headers: { cookie } }));
async function appel(nom = "paye", plus: Record<string, unknown> = {}) {
  const { cookie } = await rebond(nom, plus);
  return li.appelDe(T[nom].ctx, await sid(cookie));
}
const refus = (code: string) => expect.objectContaining({ code });
const segment = async (nom = "paye") => (await seg.creerSegment(T[nom].t, { nom: `S ${randomUUID()}`, filtre: { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }] } }, { id: "h", via: "interface" })).id;
const lignesTracees = async (nom = "paye") => (await prisma.atlasExport.findMany({ where: { tenantId: T[nom].t, canal: "liaison" } })).reduce((s, l) => s + l.lignes, 0);

describe("poignée et session", () => {
  test("la poignée passe du lien à la session, chiffrée, et le lien n'en garde rien", async () => {
    const { cookie, poignee } = await rebond("paye");
    const s = await sid(cookie);
    const l = await prisma.sessionDelegation.findFirstOrThrow({ where: { sessionId: s! } });
    expect(l.poignee).not.toContain(poignee);
    expect(cookie).not.toContain(poignee);
    expect(await poigneeDe(s, T.paye.u, T.paye.hub)).toBe(poignee);
    expect(await prisma.ssoLoginToken.findMany({ where: { userId: T.paye.u, delegation: { not: null } } })).toEqual([]);
  });
  test("une autre session, un autre utilisateur, un autre espace, une poignée expirée : rien", async () => {
    const { cookie } = await rebond("paye");
    const s = await sid(cookie);
    expect(await poigneeDe(randomUUID(), T.paye.u, T.paye.hub)).toBeNull();
    expect(await poigneeDe(null, T.paye.u, T.paye.hub)).toBeNull();
    expect(await poigneeDe(s, T.autre.u, T.paye.hub)).toBeNull();
    expect(await poigneeDe(s, T.paye.u, T.autre.hub)).toBeNull();
    await prisma.sessionDelegation.updateMany({ where: { sessionId: s! }, data: { expireLe: new Date(Date.now() - 1) } });
    expect(await poigneeDe(s, T.paye.u, T.paye.hub)).toBeNull();
  });
  test("un chiffré recopié sur une autre session ne s'ouvre pas", async () => {
    const a = await sid((await rebond("paye")).cookie);
    const b = await sid((await rebond("paye")).cookie);
    const l = await prisma.sessionDelegation.findFirstOrThrow({ where: { sessionId: a! } });
    await prisma.sessionDelegation.updateMany({ where: { sessionId: b! }, data: { poignee: l.poignee } });
    expect(await poigneeDe(b, T.paye.u, T.paye.hub)).toBeNull();
  });
  test.each([
    ["trop courte", { grant: "court" }],
    ["tenant illisible", { hub_tenant_id: "pas-un-uuid" }],
    ["déjà expirée", { expire_le: "2020-01-01T00:00:00Z" }],
    ["date illisible", { expire_le: "demain" }],
    ["absente", { grant: undefined }],
  ])("poignée %s : on entre quand même, sans liaison", async (_n, plus) => {
    const s = await sid((await rebond("paye", plus)).cookie);
    expect(s).toBeTruthy();
    expect(await prisma.sessionDelegation.findFirst({ where: { sessionId: s! } })).toBeNull();
    await expect(li.ficheVersCrm(await li.appelDe(T.paye.ctx, s), { geste: randomUUID(), siren: "100000001" })).rejects.toEqual(refus("rebond"));
    expect(hub.demandes).toEqual([]);
  });
});

test("une poignée par organisation : chacune ne sert que dans la sienne, une entrée mal formée n'en fait perdre aucune autre", async () => {
  const g = randomBytes(32).toString("base64url");
  const { cookie, poignee } = await rebond("paye", {}, [{ hub_tenant_id: T.autre.hub, grant: g, expire_le: new Date(Date.now() + 3600_000).toISOString() }, { hub_tenant_id: randomUUID(), grant: "x" }, { hub_tenant_id: "pas-un-uuid", grant: "g".repeat(43), expire_le: new Date(Date.now() + 3600_000).toISOString() }, null]);
  const s = await sid(cookie);
  expect(await poigneeDe(s, T.paye.u, T.paye.hub)).toBe(poignee);
  expect(await poigneeDe(s, T.paye.u, T.autre.hub)).toBe(g);
  expect(await prisma.sessionDelegation.count({ where: { sessionId: s! } })).toBe(2);
  // Recopiée sur l'autre organisation de la même session, elle ne s'ouvre pas.
  const l = await prisma.sessionDelegation.findFirstOrThrow({ where: { sessionId: s!, hubTenantId: T.autre.hub } });
  await prisma.sessionDelegation.updateMany({ where: { sessionId: s!, hubTenantId: T.paye.hub }, data: { poignee: l.poignee } });
  expect(await poigneeDe(s, T.paye.u, T.paye.hub)).toBeNull();
});

describe("ce que l'écran montre", () => {
  test.each([
    ["allumées", { crm: "allumee", notifuse: "allumee" }, { crm: true, notifuse: true, eteintes: [] }],
    ["une éteinte", { crm: "eteinte", notifuse: "allumee" }, { crm: false, notifuse: true, eteintes: ["crm"] }],
    ["une indisponible : ni bouton ni phrase", { crm: "allumee", notifuse: "indisponible" }, { crm: true, notifuse: false, eteintes: [] }],
    ["Hub en panne : le clic dira", "panne", { crm: true, notifuse: true, eteintes: [] }],
    ["état inconnu : le clic dira", { crm: "bizarre" }, { crm: true, notifuse: true, eteintes: [] }],
  ])("paires %s", async (_n, etats, attendu) => {
    hub.etats = etats as Etat["etats"];
    expect(await li.etatLiaisons(await appel())).toMatchObject({ ...attendu, connexion: true });
  });
  test("poignée révoquée au Hub : l'écran le sait, elle est oubliée ; un état d'un autre espace ne s'emploie pas ; drapeau éteint, aucune question au Hub", async () => {
    const a = await appel();
    hub.etats = { crm: "eteinte" };
    hub.tenantRendu = T.autre.hub;
    expect(await li.etatLiaisons(a)).toMatchObject({ crm: true, eteintes: [] });
    hub.tenantRendu = null;
    process.env.ATLAS_LIAISONS = "";
    const avant = hub.nonces.size;
    expect(await li.etatLiaisons(a)).toEqual({ crm: false, notifuse: false, eteintes: [], payant: true, connexion: false });
    expect(hub.nonces.size).toBe(avant);
    process.env.ATLAS_LIAISONS = "crm=*";
    hub.poignees.clear();
    expect(await li.etatLiaisons(a)).toMatchObject({ crm: true, notifuse: false, connexion: false });
    expect(await prisma.sessionDelegation.count({ where: { sessionId: a.sessionId! } })).toBe(0);
  });
});

describe("fiche vers le CRM", () => {
  test("un clic crée, le même geste rend le premier résultat, un second clic ne recrée rien ; une ligne tracée par geste", async () => {
    const a = await appel();
    const geste = randomUUID();
    expect(await li.ficheVersCrm(a, { geste, siren: "100000001" })).toMatchObject({ sort: "cree", url: "https://banc.crm.app.veridian.site/object/company/100000001" });
    expect(await li.ficheVersCrm(a, { geste, siren: "100000001" })).toMatchObject({ sort: "cree", rejoue: true });
    expect(crm.appels).toBe(1);
    expect(await li.ficheVersCrm(a, { geste: randomUUID(), siren: "100000001" })).toMatchObject({ sort: "deja" });
    expect(crm.fiches.size).toBe(1);
    expect(await lignesTracees()).toBe(2);
    expect(crm.cles[0]).toBe(`${geste}:100000001`);
  });
  test("réponse en flux SSE lue pareil", async () => {
    crm.sse = true;
    expect(await li.ficheVersCrm(await appel(), { geste: randomUUID(), siren: "100000001" })).toMatchObject({ sort: "cree" });
  });
  test("une panne du CRM puis un nouvel essai du même geste : envoyé une fois, compté une fois", async () => {
    const a = await appel();
    const geste = randomUUID();
    crm.panne = 1;
    await expect(li.ficheVersCrm(a, { geste, siren: "100000001" })).rejects.toEqual(refus("cible_refus"));
    expect(await li.ficheVersCrm(a, { geste, siren: "100000001" })).toMatchObject({ sort: "cree" });
    expect(await lignesTracees()).toBe(1);
  });
  test("dix clics simultanés du même geste : un seul appel", async () => {
    const a = await appel();
    const geste = randomUUID();
    const r = await Promise.allSettled(Array.from({ length: 10 }, () => li.ficheVersCrm(a, { geste, siren: "100000002" })));
    expect(r.some((x) => x.status === "fulfilled")).toBe(true);
    expect(r.filter((x) => x.status === "rejected").every((x) => (x as PromiseRejectedResult).reason.code === "en_cours")).toBe(true);
    expect(crm.appels).toBe(1);
  });
  test("un geste ne se réemploie pas pour une autre entreprise", async () => {
    const a = await appel();
    const geste = randomUUID();
    await li.ficheVersCrm(a, { geste, siren: "100000001" });
    await expect(li.ficheVersCrm(a, { geste, siren: "100000002" })).rejects.toEqual(refus("geste_reutilise"));
  });
  test.each([
    ["integration_off", 403, "paire_eteinte"],
    ["pair_not_allowed", 403, "paire_absente"],
    ["target_not_served", 403, "paire_absente"],
    ["grant_invalid", 403, "rebond"],
    ["not_member", 403, "membre_requis"],
    ["tenant_suspended", 403, "tenant_suspendu"],
    ["app_not_open", 403, "app_non_ouverte"],
    ["rate_limited", 429, "plafond"],
    ["invalid_signature", 401, "hub_refus"],
    ["inconnu", 500, "hub_refus"],
  ])("le Hub répond %s : message clair, rien chez le CRM", async (error, status, code) => {
    hub.forcer = { status: status as number, corps: { error } };
    await expect(li.ficheVersCrm(await appel(), { geste: randomUUID(), siren: "100000001" })).rejects.toEqual(refus(code));
    expect(crm.appels).toBe(0);
  });
  test("poignée refusée par le Hub : oubliée, l'écran sait qu'il faut un rebond", async () => {
    const a = await appel();
    hub.poignees.clear();
    await expect(li.ficheVersCrm(a, { geste: randomUUID(), siren: "100000001" })).rejects.toEqual(refus("rebond"));
    expect((await li.etatLiaisons(a)).connexion).toBe(false);
  });
  test("paire éteinte dans l'organisation : dit à qui s'adresser", async () => {
    hub.paire.crm = false;
    await expect(li.ficheVersCrm(await appel(), { geste: randomUUID(), siren: "100000001" })).rejects.toThrow(/éteinte.*propriétaire ou un administrateur/);
  });
  test("le Hub rend un jeton d'un autre espace : refusé avant tout appel", async () => {
    hub.tenantRendu = T.autre.hub;
    await expect(li.ficheVersCrm(await appel(), { geste: randomUUID(), siren: "100000001" })).rejects.toEqual(refus("autre_espace"));
    expect(crm.appels).toBe(0);
  });
  test("CRM non relié, entreprise bloquée, société en corbeille", async () => {
    const a = await appel();
    crm.tenants.clear();
    await expect(li.ficheVersCrm(a, { geste: randomUUID(), siren: "100000001" })).rejects.toEqual(refus("cible_non_reliee"));
    crm.tenants.add(T.paye.hub);
    odh.bloques.add("100000003");
    await expect(li.ficheVersCrm(a, { geste: randomUUID(), siren: "100000003" })).rejects.toEqual(refus("non_prospectable"));
    crm.corbeille.add("100000004");
    expect(await li.ficheVersCrm(a, { geste: randomUUID(), siren: "100000004" })).toMatchObject({ sort: "refuse" });
  });
  test("drapeau éteint, lecture seule, plan gratuit, espace non relié : rien ne part", async () => {
    const a = await appel();
    const e = () => ({ geste: randomUUID(), siren: "100000001" });
    await expect(li.ficheVersCrm({ ...a, ctx: { ...a.ctx, isAdmin: false, workspaces: [{ id: "w", name: "w", slug: "w", role: "viewer", visibilityScope: "all" }] } }, e())).rejects.toEqual(refus("lecture_seule"));
    await expect(li.ficheVersCrm(await appel("gratuit"), e())).rejects.toEqual(refus("plan"));
    await expect(li.ficheVersCrm({ ...a, hubTenantId: null }, e())).rejects.toEqual(refus("eteinte"));
    for (const v of ["", "crm", "notifuse=*", `crm=${T.autre.hub}`]) {
      process.env.ATLAS_LIAISONS = v;
      await expect(li.ficheVersCrm(a, e())).rejects.toEqual(refus("eteinte"));
      expect((await li.etatLiaisons(a)).crm).toBe(false);
    }
    process.env.ATLAS_LIAISONS = `crm=${T.paye.hub}`;
    expect(await li.etatLiaisons(a)).toMatchObject({ crm: true, notifuse: false, connexion: true });
    expect(hub.demandes).toEqual([]);
  });
  test("quota du jour commun avec l'extraction", async () => {
    await prisma.atlasExport.create({ data: { tenantId: T.paye.t, userId: T.paye.u, canal: "mcp", format: "json", segmentId: randomUUID(), segmentVersion: 1, lignes: 4999 } });
    const a = await appel();
    await li.ficheVersCrm(a, { geste: randomUUID(), siren: "100000001" });
    await expect(li.ficheVersCrm(a, { geste: randomUUID(), siren: "100000002" })).rejects.toThrow(/Quota du jour/);
    expect(crm.appels).toBe(1);
  });
});

describe("segment vers le CRM", () => {
  test("page par page, tout arrive une fois ; rejoué, rien de neuf ; un refus général arrête et se reprend", async () => {
    const a = await appel();
    const s = await segment();
    const geste = randomUUID();
    const p1 = await li.segmentVersCrm(a, { geste, segmentId: s });
    expect(p1).toMatchObject({ traitees: 20, creees: 20, total: 45 });
    crm.panne = 1;
    await expect(li.segmentVersCrm(a, { geste, segmentId: s, curseur: p1.curseur_suivant })).rejects.toEqual(refus("cible_refus"));
    const p2 = await li.segmentVersCrm(a, { geste, segmentId: s, curseur: p1.curseur_suivant });
    const p3 = await li.segmentVersCrm(a, { geste, segmentId: s, curseur: p2.curseur_suivant });
    expect([p2.traitees, p3.traitees, p3.curseur_suivant]).toEqual([20, 5, null]);
    expect(crm.fiches.size).toBe(45);
    expect(await lignesTracees()).toBe(45);
    // Un jeton et un appel par lot de 20 : trois lots, plus celui de la panne.
    expect([crm.appels, hub.demandes.length]).toEqual([4, 4]);
    const avant = crm.appels;
    expect(await li.segmentVersCrm(a, { geste, segmentId: s })).toMatchObject({ rejoue: true, creees: 20 });
    expect(crm.appels).toBe(avant);
    expect(new Set(hub.demandes.map((d) => d.headers["x-veridian-nonce"])).size).toBe(hub.demandes.length);
  });
  test("le CRM n'a pas tout traité à temps : la page se reprend, rien n'est compté ni créé deux fois", async () => {
    const a = await appel();
    const s = await segment();
    const geste = randomUUID();
    crm.lenteur = 1;
    await expect(li.segmentVersCrm(a, { geste, segmentId: s })).rejects.toEqual(refus("a_reprendre"));
    expect(crm.fiches.size).toBe(10);
    expect(await li.segmentVersCrm(a, { geste, segmentId: s })).toMatchObject({ traitees: 20, creees: 10, deja: 10 });
    expect([crm.fiches.size, await lignesTracees()]).toEqual([20, 20]);
  });
  test("le CRM oublie une société dans sa réponse : jamais lu comme un succès", async () => {
    crm.oubli = true;
    await expect(li.segmentVersCrm(await appel(), { geste: randomUUID(), segmentId: await segment() })).rejects.toEqual(refus("a_reprendre"));
  });
  test("société en corbeille : les autres passent ; rôle CRM insuffisant : tout s'arrête", async () => {
    const a = await appel();
    const s = await segment();
    crm.corbeille.add("100000003");
    const p = await li.segmentVersCrm(a, { geste: randomUUID(), segmentId: s });
    expect([p.creees, p.refusees]).toEqual([19, [{ siren: "100000003", message: "Cette société est dans la corbeille du CRM." }]]);
    crm.droits = true;
    await expect(li.segmentVersCrm(a, { geste: randomUUID(), segmentId: s })).rejects.toEqual(refus("cible_droits"));
  });
  test("100 sociétés au plus par geste", async () => {
    odh.n = 150;
    const a = await appel();
    const s = await segment();
    const geste = randomUUID();
    let curseur: string | null = null;
    for (let i = 0; i < 5; i++) curseur = (await li.segmentVersCrm(a, { geste, segmentId: s, curseur })).curseur_suivant;
    expect(crm.fiches.size).toBe(100);
    await expect(li.segmentVersCrm(a, { geste, segmentId: s, curseur })).rejects.toEqual(refus("lot_plein"));
    expect(await li.segmentVersCrm(a, { geste: randomUUID(), segmentId: s, curseur })).toMatchObject({ traitees: 20 });
  });
  test("le segment d'un autre espace est introuvable", async () => {
    const s = await segment("autre");
    await expect(li.segmentVersCrm(await appel(), { geste: randomUUID(), segmentId: s })).rejects.toThrow(seg.Introuvable);
    expect(crm.appels).toBe(0);
  });
});

describe("vers Mail", () => {
  const simuler = async (a: li.Appel, geste: string, segmentId: string, listeId = "reserve") => {
    const pages = [];
    let curseur: string | null = null;
    do {
      const p: Awaited<ReturnType<typeof li.segmentVersMail>> = await li.segmentVersMail(a, { geste, segmentId, listeId, curseur, simulation: true });
      pages.push(p);
      curseur = p.curseur_suivant;
    } while (curseur);
    return pages;
  };

  test("simulation puis confirmation : pages de 1 000, exclusions de Mail, aucun doublon au rejeu, compté une fois", async () => {
    odh.n = 2300;
    mail.desinscrits.add("contact@e100000000.invalid");
    const a = await appel();
    const s = await segment();
    const geste = randomUUID();
    const sim = await simuler(a, geste, s);
    expect(sim.map((p) => p.recus)).toEqual([1000, 1000, 300]);
    expect(mail.contacts.size).toBe(0);
    expect(sim[0]).toMatchObject({ crees: 999, ecartes: { desinscrit: 1 } });
    expect(await lignesTracees()).toBe(2300);
    for (const p of sim) await li.segmentVersMail(a, { geste, segmentId: s, listeId: "reserve", curseur: p.curseur_page, simulation: false });
    expect(mail.contacts.size).toBe(2299);
    expect(mail.contacts.has("contact@e100000000.invalid")).toBe(false);
    expect(await lignesTracees()).toBe(2300);
    const geste2 = randomUUID();
    const sim2 = await simuler(a, geste2, s);
    for (const p of sim2) await li.segmentVersMail(a, { geste: geste2, segmentId: s, listeId: "reserve", curseur: p.curseur_page, simulation: false });
    expect(mail.contacts.size).toBe(2299);
    expect(await lignesTracees()).toBe(2300);
    expect(mail.appels.every((x) => !("allow_triggers" in x.args))).toBe(true);
    expect(mail.appels.every((x) => x.outil === "contacts.importer")).toBe(true);
    expect([...mail.contacts.values()][0]).toMatchObject({ siren: expect.stringMatching(/^\d{9}$/), source: "Veridian Atlas", first_name: "CAROLE", last_name: "GABARROCA" });
  });
  test("sans simulation, ou vers une autre liste que celle simulée : refusé", async () => {
    const a = await appel();
    const s = await segment();
    const geste = randomUUID();
    const importer = (listeId: string, curseur?: string | null, g = geste) => li.segmentVersMail(a, { geste: g, segmentId: s, listeId, curseur, simulation: false });
    await expect(importer("reserve")).rejects.toEqual(refus("simuler"));
    const [p] = await simuler(a, geste, s);
    await expect(importer("autre", p.curseur_page)).rejects.toEqual(refus("simuler"));
    await expect(importer("reserve", p.curseur_page, randomUUID())).rejects.toEqual(refus("simuler"));
    expect(mail.contacts.size).toBe(0);
    await importer("reserve", p.curseur_page);
    expect(mail.contacts.size).toBe(45);
  });
  test("coupure au milieu : la page reprend, rien n'est compté deux fois", async () => {
    odh.n = 1500;
    const a = await appel();
    const s = await segment();
    const geste = randomUUID();
    const [p1, p2] = await simuler(a, geste, s);
    const importer = (p: { curseur_page?: string }) => li.segmentVersMail(a, { geste, segmentId: s, listeId: "reserve", curseur: p.curseur_page, simulation: false });
    await importer(p1);
    mail.sautePage = 1;
    await expect(importer(p2)).rejects.toEqual(refus("cible_refus"));
    await importer(p2);
    expect(mail.contacts.size).toBe(1500);
    expect(await lignesTracees()).toBe(1500);
  });
  test("une liste qui déclenche une séquence : vue à la simulation, refusée à l'import", async () => {
    mail.sequence.add("reserve");
    const a = await appel();
    const s = await segment();
    const geste = randomUUID();
    const [p] = await simuler(a, geste, s);
    expect(p.declenche).toBe(true);
    await expect(li.segmentVersMail(a, { geste, segmentId: s, listeId: "reserve", curseur: p.curseur_page, simulation: false })).rejects.toEqual(refus("sequence"));
    expect(mail.contacts.size).toBe(0);
  });
  test("une fiche : comptée à l'import seulement ; sans email utilisable, refusée", async () => {
    const a = await appel();
    const geste = randomUUID();
    const e = { geste, siren: "100000005", listeId: "reserve" };
    expect(await li.ficheVersMail(a, { ...e, simulation: true })).toMatchObject({ crees: 1 });
    expect([mail.contacts.size, await lignesTracees()]).toEqual([0, 0]);
    expect(await li.ficheVersMail(a, { ...e, simulation: false })).toMatchObject({ crees: 1 });
    expect([mail.contacts.size, await lignesTracees()]).toEqual([1, 1]);
    odh.bloques.add("100000006");
    await expect(li.ficheVersMail(a, { geste: randomUUID(), siren: "100000006", listeId: "reserve", simulation: true })).rejects.toEqual(refus("sans_email"));
  });
  test.each([["dry_run", "reponse_invalide"], ["http", "cible_refus"]] as const)("Mail répond à côté (%s) : jamais présenté comme réussi", async (ment, code) => {
    mail.ment = ment;
    await expect(li.ficheVersMail(await appel(), { geste: randomUUID(), siren: "100000005", listeId: "reserve", simulation: true })).rejects.toEqual(refus(code));
  });
  test("listes lues et créées chez Mail, une seule fois par geste", async () => {
    const a = await appel();
    expect((await li.listesMail(a)).listes).toEqual([{ id: "reserve", nom: "Réserve", sequence: false }]);
    mail.sequence.add("reserve");
    expect((await li.listesMail(a)).listes[0].sequence).toBe(true);
    mail.ment = "http";
    await expect(li.listesMail(a)).rejects.toEqual(refus("reponse_invalide"));
    mail.ment = "";
    const geste = randomUUID();
    const l = await li.creerListeMail(a, { geste, nom: "Éleveurs" });
    expect((await li.creerListeMail(a, { geste, nom: "Éleveurs" })).id).toBe(l.id);
    expect(l.id).toMatch(/^[a-z0-9]{1,32}$/);
    expect(mail.listes.size).toBe(2);
  });
  test("le journal des envois ne garde ni email ni téléphone", async () => {
    const a = await appel();
    await li.ficheVersCrm(a, { geste: randomUUID(), siren: "100000001" });
    await simuler(a, randomUUID(), await segment());
    const brut = JSON.stringify(await prisma.atlasEnvoi.findMany({ where: { tenantId: T.paye.t } }));
    expect(brut).not.toMatch(/@|0400000000/);
  });
});
