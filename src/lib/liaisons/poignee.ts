/**
 * Poignées de délégation (INTEGRATIONS-NATIVES §2.1, VER-246) : jetons opaques que le Hub joint au rebond
 * (`delegations`), un par organisation, chacun lié à (utilisateur, app, tenant). Elle permet de demander au Hub un jeton d'action de 120 s, jamais plus.
 *
 * Gardée chiffrée (AES-256-GCM, clé dérivée d'AUTH_SECRET) : d'abord sur le lien de connexion à usage unique, puis
 * liée à l'identifiant de la session ouverte (`sid` du JWT). Elle ne va jamais au navigateur. Une copie de la base
 * ne suffit pas à s'en servir : il faut la clé, et le secret qui signe les appels au Hub.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";

const DUREE_MAX_MS = 90 * 24 * 3600 * 1000; // celle de la session
const POIGNEE = /^[A-Za-z0-9._~-]{32,512}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Au-delà, ce n'est plus une personne. */
const ORGANISATIONS_MAX = 50;

export type Delegation = { poignee: string; hubTenantId: string; expireLe: Date };

function cle(): Buffer {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET absent");
  return Buffer.from(hkdfSync("sha256", secret, "veridian-atlas", "delegation-v1", 32));
}

/** `contexte` lie le chiffré à sa ligne (empreinte du lien, ou session) : recopié sur une autre, il ne s'ouvre pas. */
export function chiffrer(texte: string, contexte: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cle(), iv).setAAD(Buffer.from(contexte));
  const corps = Buffer.concat([c.update(texte, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), corps]).toString("base64url");
}

export function dechiffrer(chiffre: string, contexte: string): string | null {
  try {
    const b = Buffer.from(chiffre, "base64url");
    const d = createDecipheriv("aes-256-gcm", cle(), b.subarray(0, 12), { authTagLength: 16 }).setAAD(Buffer.from(contexte));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Lit `delegations` du corps signé du rebond. Une entrée mal formée est écartée, jamais élargie ; les autres restent. */
export function lireDelegations(brut: unknown, maintenant = Date.now()): Delegation[] {
  if (!Array.isArray(brut)) return [];
  const par = new Map<string, Delegation>();
  for (const e of brut.slice(0, ORGANISATIONS_MAX)) {
    const { grant: g, hub_tenant_id: t, expire_le: x } = (e ?? {}) as Record<string, unknown>;
    if (typeof g !== "string" || !POIGNEE.test(g) || typeof t !== "string" || !UUID.test(t)) continue;
    const fin = typeof x === "string" ? Date.parse(x) : NaN;
    if (!Number.isFinite(fin) || fin <= maintenant) continue;
    par.set(t.toLowerCase(), { poignee: g, hubTenantId: t.toLowerCase(), expireLe: new Date(Math.min(fin, maintenant + DUREE_MAX_MS)) });
  }
  return [...par.values()];
}

/** Pour `sso_login_tokens.delegation`. */
export function emballer(d: readonly Delegation[], empreinteLien: string): string {
  return chiffrer(JSON.stringify(d.map((x) => ({ p: x.poignee, t: x.hubTenantId, x: x.expireLe.toISOString() }))), `lien:${empreinteLien}`);
}

/** À l'ouverture de la session : les poignées passent du lien à la session. Ne doit jamais faire échouer une connexion. */
export async function attacher(emballee: string, empreinteLien: string, sessionId: string, userId: string): Promise<boolean> {
  const brut = dechiffrer(emballee, `lien:${empreinteLien}`);
  if (!brut) return false;
  const vivantes = (JSON.parse(brut) as { p: string; t: string; x: string }[]).filter((d) => Date.parse(d.x) > Date.now());
  await prisma.sessionDelegation.deleteMany({ where: { userId, expireLe: { lt: new Date() } } });
  const r = await prisma.sessionDelegation.createMany({
    data: vivantes.map((d) => ({ sessionId, userId, hubTenantId: d.t, poignee: chiffrer(d.p, contexte(sessionId, d.t)), expireLe: new Date(d.x) })),
  });
  return r.count > 0;
}

const contexte = (sessionId: string, hubTenantId: string) => `session:${sessionId}:${hubTenantId}`;

/** Poignée vivante de CETTE session, pour CET utilisateur et CE tenant Hub. Une autre session ou un autre espace : null. */
export async function poigneeDe(sessionId: string | null, userId: string, hubTenantId: string): Promise<string | null> {
  if (!sessionId || !UUID.test(sessionId) || !UUID.test(hubTenantId)) return null;
  const t = hubTenantId.toLowerCase();
  const l = await prisma.sessionDelegation.findFirst({ where: { sessionId, userId, hubTenantId: t, expireLe: { gt: new Date() } } });
  return l ? dechiffrer(l.poignee, contexte(sessionId, t)) : null;
}

/** Le Hub a refusé cette poignée (révoquée, expirée) : on ne la représente plus. */
export async function oublierPoignee(sessionId: string, hubTenantId: string): Promise<void> {
  await prisma.sessionDelegation.deleteMany({ where: { sessionId, hubTenantId: hubTenantId.toLowerCase() } });
}

export async function oublierSession(sessionId: unknown): Promise<void> {
  if (typeof sessionId === "string" && UUID.test(sessionId)) await prisma.sessionDelegation.deleteMany({ where: { sessionId } });
}
