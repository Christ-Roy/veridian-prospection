/**
 * Poignée de délégation (INTEGRATIONS-NATIVES §2.1, VER-246) : jeton opaque que le Hub joint au rebond, lié à
 * (utilisateur, app, tenant). Elle permet de demander au Hub un jeton d'action de 120 s, jamais plus.
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

export type Delegation = { poignee: string; hubTenantId: string | null; expireLe: Date };

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

/** Lit la délégation du corps signé du rebond. Absente ou mal formée : null, et la connexion se fait comme avant. */
export function lireDelegation(corps: Record<string, unknown>, maintenant = Date.now()): Delegation | null {
  const { delegation_grant: g, delegation_tenant_id: t, delegation_expires_at: x } = corps;
  if (typeof g !== "string" || !POIGNEE.test(g)) return null;
  // Un tenant ou une date illisibles ne s'ignorent pas : sans eux la poignée serait plus large que voulu.
  if (t !== undefined && t !== null && (typeof t !== "string" || !UUID.test(t))) return null;
  let fin = maintenant + DUREE_MAX_MS;
  if (x !== undefined && x !== null) {
    const d = typeof x === "string" ? Date.parse(x) : NaN;
    if (!Number.isFinite(d) || d <= maintenant) return null;
    fin = Math.min(fin, d);
  }
  return { poignee: g, hubTenantId: typeof t === "string" ? t.toLowerCase() : null, expireLe: new Date(fin) };
}

/** Pour `sso_login_tokens.delegation`. */
export function emballer(d: Delegation, empreinteLien: string): string {
  return chiffrer(JSON.stringify({ p: d.poignee, t: d.hubTenantId, x: d.expireLe.toISOString() }), `lien:${empreinteLien}`);
}

/** À l'ouverture de la session : la poignée passe du lien à la session. Ne doit jamais faire échouer une connexion. */
export async function attacher(emballee: string, empreinteLien: string, sessionId: string, userId: string): Promise<boolean> {
  const brut = dechiffrer(emballee, `lien:${empreinteLien}`);
  if (!brut) return false;
  const { p, t, x } = JSON.parse(brut) as { p: string; t: string | null; x: string };
  const expireLe = new Date(x);
  if (expireLe.getTime() <= Date.now()) return false;
  await prisma.sessionDelegation.deleteMany({ where: { userId, expireLe: { lt: new Date() } } });
  await prisma.sessionDelegation.create({ data: { sessionId, userId, hubTenantId: t, poignee: chiffrer(p, `session:${sessionId}`), expireLe } });
  return true;
}

/** Poignée vivante de CETTE session pour CET utilisateur et CE tenant Hub. Une autre session ou un autre espace : null. */
export async function poigneeDe(sessionId: string | null, userId: string, hubTenantId: string): Promise<string | null> {
  if (!sessionId || !UUID.test(sessionId)) return null;
  const l = await prisma.sessionDelegation.findFirst({ where: { sessionId, userId, expireLe: { gt: new Date() } } });
  if (!l || (l.hubTenantId && l.hubTenantId.toLowerCase() !== hubTenantId.toLowerCase())) return null;
  return dechiffrer(l.poignee, `session:${sessionId}`);
}

export async function oublierSession(sessionId: unknown): Promise<void> {
  if (typeof sessionId === "string" && UUID.test(sessionId)) await prisma.sessionDelegation.deleteMany({ where: { sessionId } });
}
