/**
 * Accès avancé Atlas (16/11, Robert) : un espace « très proche » a les requêtes SQL en lecture sur ODH et des
 * clés API pour ses scripts. Le droit s'accorde un espace à la fois, par un administrateur Atlas
 * (users.atlas_admin), jamais par le plan : un plan payant donne l'export, pas la base brute.
 *
 * Clés : `atl_` + 32 octets aléatoires en base64url. Seule l'empreinte SHA-256 est gardée ; la clé n'est montrée
 * qu'à sa création. Elle agit au nom de son créateur, dans son espace, avec ses droits, et cesse de marcher si
 * elle est révoquée ou si l'espace perd l'accès avancé.
 */
import { createHash, randomBytes } from "node:crypto";

import { isUserFrozen } from "@/lib/auth/freeze";
import type { UserContext } from "@/lib/auth/user-context";
import { peutExporter } from "./export";
import { prisma } from "@/lib/prisma";

export class RefusAcces extends Error {}

export type Droits = { accesAvance: boolean; adminAtlas: boolean; plan: string | null; payant: boolean };

const cache = new Map<string, { t: number; v: Droits }>();
const DUREE = 30_000;

/** Droits Atlas d'un utilisateur dans un espace, gardés 30 s. */
export async function droits(userId: string, tenantId: string, frais = false): Promise<Droits> {
  const k = `${userId}:${tenantId}`;
  const c = cache.get(k);
  if (!frais && c && Date.now() - c.t < DUREE) return c.v;
  // Lecture impossible : aucun droit réservé (fermé par défaut), sans garder ce résultat en cache.
  let t: { accesAvance: boolean; plan: string | null } | null = null;
  let u: { atlasAdmin: boolean } | null = null;
  try {
    [t, u] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { accesAvance: true, plan: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { atlasAdmin: true } }),
    ]);
  } catch (e) {
    console.error("[atlas] droits illisibles :", e instanceof Error ? e.message : e);
  }
  if (t === null && u === null) return { accesAvance: false, adminAtlas: false, plan: null, payant: false };
  const v = { accesAvance: !!t?.accesAvance, adminAtlas: !!u?.atlasAdmin, plan: t?.plan ?? null, payant: peutExporter(t?.plan) };
  cache.set(k, { t: Date.now(), v });
  return v;
}
export function oublierDroits(): void {
  cache.clear();
}

export const empreinte = (cle: string) => createHash("sha256").update(cle).digest("hex");

/** Crée une clé : rendue en clair une seule fois. */
export async function creerCle(ctx: Pick<UserContext, "userId" | "tenantId">, nom: string) {
  const d = await droits(ctx.userId, ctx.tenantId);
  if (!d.accesAvance) throw new RefusAcces("Les clés API demandent l'accès avancé de l'espace.");
  const actives = await prisma.atlasCleApi.count({ where: { tenantId: ctx.tenantId, revoqueeLe: null } });
  if (actives >= 10) throw new RefusAcces("10 clés actives au plus par espace : révoquez-en une.");
  const cle = `atl_${randomBytes(32).toString("base64url")}`;
  const c = await prisma.atlasCleApi.create({
    data: { tenantId: ctx.tenantId, userId: ctx.userId, nom: nom.trim().slice(0, 80) || "Clé", prefixe: cle.slice(0, 12), empreinte: empreinte(cle) },
  });
  return { id: c.id, nom: c.nom, prefixe: c.prefixe, cree_le: c.creeLe, cle };
}

export async function listerCles(tenantId: string) {
  const l = await prisma.atlasCleApi.findMany({ where: { tenantId }, orderBy: { creeLe: "desc" } });
  const auteurs = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...new Set(l.map((c) => c.userId))] } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]),
  );
  return l.map((c) => ({
    id: c.id,
    nom: c.nom,
    prefixe: c.prefixe,
    auteur: auteurs.get(c.userId) ?? null,
    cree_le: c.creeLe,
    derniere_utilisation: c.derniereUtilisation,
    revoquee_le: c.revoqueeLe,
  }));
}

export async function revoquerCle(tenantId: string, id: string) {
  const r = await prisma.atlasCleApi.updateMany({ where: { id, tenantId, revoqueeLe: null }, data: { revoqueeLe: new Date() } });
  if (!r.count) throw new RefusAcces("Clé introuvable ou déjà révoquée.");
  return { id, revoquee: true };
}

/** Membre retiré ou compte supprimé : ses clés meurent pour de bon, le remettre dans l'espace ne les ranime pas. */
export async function revoquerClesDe(userId: string, tenantId?: string): Promise<number> {
  const r = await prisma.atlasCleApi.updateMany({ where: { userId, ...(tenantId ? { tenantId } : {}), revoqueeLe: null }, data: { revoqueeLe: new Date() } });
  return r.count;
}

const vues = new Map<string, number>();

/**
 * Contexte d'une requête signée par une clé (`Authorization: Bearer atl_…`), ou null si la clé est inconnue,
 * révoquée, si son espace a perdu l'accès avancé, est suspendu ou fermé, ou si son créateur est supprimé, gelé ou retiré.
 */
export async function contexteDepuisCle(entete: string | null): Promise<UserContext | null> {
  const m = entete?.match(/^Bearer\s+(atl_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const c = await prisma.atlasCleApi.findUnique({ where: { empreinte: empreinte(m[1]) } });
  if (!c || c.revoqueeLe) return null;
  if (!(await droits(c.userId, c.tenantId)).accesAvance) return null;
  const [u, t, gel] = await Promise.all([
    prisma.user.findFirst({ where: { id: c.userId, deletedAt: null }, select: { id: true, email: true } }),
    prisma.tenant.findFirst({ where: { id: c.tenantId, deletedAt: null, status: { not: "suspended" } }, select: { id: true } }),
    isUserFrozen(c.userId, c.tenantId),
  ]);
  if (!u || !t || gel) return null;
  // Import tardif : le contexte tire l'authentification (next-auth), inutile aux outils et à leurs tests.
  const { buildUserContext } = await import("@/lib/auth/user-context");
  const ctx = await buildUserContext(u, null, c.tenantId);
  if (!ctx || ctx.tenantId !== c.tenantId) return null; // le créateur a quitté l'espace : la clé ne vaut plus
  // Dernière utilisation : une écriture par minute au plus.
  if (Date.now() - (vues.get(c.id) ?? 0) > 60_000) {
    vues.set(c.id, Date.now());
    await prisma.atlasCleApi.update({ where: { id: c.id }, data: { derniereUtilisation: new Date() } }).catch(() => undefined);
  }
  return ctx;
}

/** Administrateur Atlas : accorde ou retire l'accès avancé à l'espace dont l'adresse est propriétaire. */
export async function accorderAcces(adminUserId: string, email: string, actif: boolean) {
  const admin = await prisma.user.findUnique({ where: { id: adminUserId }, select: { atlasAdmin: true } });
  if (!admin?.atlasAdmin) throw new RefusAcces("Réservé aux administrateurs Atlas.");
  const u = await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } }, select: { id: true, email: true } });
  if (!u) throw new RefusAcces(`Aucun compte Atlas pour ${email} : il se crée au Hub.`);
  const t = await prisma.tenant.findFirst({ where: { userId: u.id, deletedAt: null }, select: { id: true, name: true, slug: true } });
  if (!t) throw new RefusAcces(`${u.email} n'est propriétaire d'aucun espace.`);
  await prisma.tenant.update({ where: { id: t.id }, data: { accesAvance: actif } });
  if (!actif) await prisma.atlasCleApi.updateMany({ where: { tenantId: t.id, revoqueeLe: null }, data: { revoqueeLe: new Date() } });
  oublierDroits();
  console.log(`[atlas] acces_avance=${actif} espace=${t.slug} par=${adminUserId}`);
  return { email: u.email, espace: t.name, acces_avance: actif, ...(actif ? {} : { cles_revoquees: true }) };
}

export async function listerAccesAvances(adminUserId: string) {
  const admin = await prisma.user.findUnique({ where: { id: adminUserId }, select: { atlasAdmin: true } });
  if (!admin?.atlasAdmin) throw new RefusAcces("Réservé aux administrateurs Atlas.");
  const t = await prisma.tenant.findMany({ where: { accesAvance: true, deletedAt: null }, select: { id: true, name: true, userId: true } });
  const emails = new Map((await prisma.user.findMany({ where: { id: { in: t.map((x) => x.userId) } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  return t.map((x) => ({ espace: x.name, email: emails.get(x.userId) ?? null }));
}
