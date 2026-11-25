/**
 * Clients de l'espace (VISION-ATLAS R1) : importés par SIREN ou SIRET, ils donnent le taux de pénétration d'un marché et
 * servent de filtre (« Est déjà client »). On ne garde que le numéro, jamais une donnée du fichier importé.
 */
import { prisma } from "@/lib/prisma";

import { poserClients } from "./clients-portee";
import { entreeDepuisFiltre } from "./cube";
import { FiltreInvalide, FiltreSchema, type Filtre } from "./filtres";
import { libelleValeur } from "./libelles";
import { compilerMaitre } from "./maitre";
import { sourceMarche } from "./source";

/** Plafond par espace : au-delà, la liste ne tient plus dans une requête ClickHouse. */
export const CLIENTS_MAX = 20_000;

/** Clé de contrôle d'un SIREN (Luhn) : écarte un téléphone ou un montant pris pour un numéro. */
export function sirenValide(s: string): boolean {
  if (!/^\d{9}$/.test(s) || /^0+$/.test(s)) return false;
  let t = 0;
  for (let i = 0; i < 9; i++) {
    const d = Number(s[8 - i]) * (i % 2 ? 2 : 1);
    t += d > 9 ? d - 9 : d;
  }
  return t % 10 === 0;
}

/** SIREN ou SIRET, espaces et points permis ; un tableur qui a mangé les zéros de tête se répare si la clé tombe juste. */
export function lireNumero(brut: string): string | null {
  const c = brut.replace(/[\s.\u00a0\u202f-]/g, "").replace(/^FR\d{2}(?=\d{9}$)/i, "");
  if (!/^\d{7,14}$/.test(c)) return null;
  const s = c.length <= 9 ? c.padStart(9, "0") : c.length >= 13 ? c.padStart(14, "0").slice(0, 9) : "";
  return sirenValide(s) ? s : null;
}

const cache = new Map<string, { t: number; v: string[] }>();
const DUREE = 30_000;

export async function sirensClients(tenantId: string): Promise<string[]> {
  const c = cache.get(tenantId);
  if (c && Date.now() - c.t < DUREE) return c.v;
  const v = (await prisma.atlasClient.findMany({ where: { tenantId }, select: { siren: true }, orderBy: { siren: "asc" }, take: CLIENTS_MAX })).map((x) => x.siren);
  if (cache.size > 500) cache.clear();
  cache.set(tenantId, { t: Date.now(), v });
  return v;
}

/** Exécute avec les clients de l'espace à portée du compilateur de filtres. */
export async function avecClients<T>(tenantId: string, f: () => Promise<T>): Promise<T> {
  let sirens: string[];
  try {
    sirens = await sirensClients(tenantId);
  } catch (e) {
    // Liste illisible : l'appel continue, seul le filtre « Est déjà client » se refuse, jamais un filtre ignoré en silence.
    console.error("[atlas] clients illisibles :", e instanceof Error ? e.message : e);
    return f();
  }
  return poserClients(sirens, f);
}

export async function importerClients(tenantId: string, auteur: string, entrees: readonly string[]) {
  const invalides: string[] = [];
  const sirens = new Set<string>();
  for (const e of entrees) {
    const s = lireNumero(e);
    if (s) sirens.add(s);
    else if (e.trim()) invalides.push(e.trim().slice(0, 40));
  }
  const avant = await prisma.atlasClient.count({ where: { tenantId } });
  const neufs = [...sirens];
  const connus = neufs.length ? new Set((await prisma.atlasClient.findMany({ where: { tenantId, siren: { in: neufs } }, select: { siren: true } })).map((x) => x.siren)) : new Set<string>();
  const aPoser = neufs.filter((s) => !connus.has(s));
  if (avant + aPoser.length > CLIENTS_MAX) throw new FiltreInvalide(`${CLIENTS_MAX.toLocaleString("fr-FR")} clients au plus par espace : il en a ${avant}, ${aPoser.length} seraient ajoutés.`);
  const r = await prisma.atlasClient.createMany({ data: aPoser.map((siren) => ({ tenantId, siren, ajoutePar: auteur })), skipDuplicates: true });
  cache.delete(tenantId);
  return { recus: entrees.length, ajoutes: r.count, deja: neufs.length - r.count, invalides: invalides.length, exemples_invalides: invalides.slice(0, 5), total: avant + r.count };
}

export async function retirerClients(tenantId: string, sirens: readonly string[] | "tous") {
  const r = await prisma.atlasClient.deleteMany({ where: { tenantId, ...(sirens === "tous" ? {} : { siren: { in: sirens.map((s) => lireNumero(s) ?? s) } }) } });
  cache.delete(tenantId);
  return { retires: r.count, total: await prisma.atlasClient.count({ where: { tenantId } }) };
}

/** Ce que le marché et la base maître savent compter tous les deux : le taux n'a de sens que sur la même définition. */
export function definitionMarche(brut: unknown): { filtre: Filtre; ignorees: Filtre["conditions"] } {
  const f = FiltreSchema.parse(brut ?? {});
  const cle = (c: unknown) => JSON.stringify(c);
  const horsCube = new Set(entreeDepuisFiltre(f).ignorees.map(cle));
  const gardees = f.conditions.filter((c) => !horsCube.has(cle(c)));
  const horsMaitre = new Set(compilerMaitre({ conditions: gardees.filter((c) => c.champ !== "client") }).ignorees.map(cle));
  return { filtre: { conditions: gardees.filter((c) => !horsMaitre.has(cle(c))), inclure_bloques: false }, ignorees: f.conditions.filter((c) => horsCube.has(cle(c)) || horsMaitre.has(cle(c))) };
}

const taux = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 1e6) / 1e4 : null);

/** Part des entreprises actives d'un marché qui sont clientes, et où elles sont. */
export async function penetration(tenantId: string, brut: unknown, axe?: "departement" | "naf") {
  const sirens = await sirensClients(tenantId);
  const { filtre, ignorees } = definitionMarche(brut);
  const s = sourceMarche();
  const [marche, c] = await Promise.all([
    s.marche({ ...entreeDepuisFiltre(filtre).entree, ...(axe ? { axe, limite: 200 } : {}) }),
    s.compterParmi(filtre, sirens, axe),
  ]);
  const parCle = new Map(marche.lignes.map((l) => [l.cle, l.entreprises]));
  return {
    clients_importes: sirens.length,
    clients_dans_le_marche: c.total,
    entreprises_du_marche: marche.total.entreprises,
    taux_pct: taux(c.total, marche.total.entreprises),
    conditions_ignorees: ignorees,
    ...(axe ? { axe, lignes: c.lignes.slice(0, 50).map((l) => ({ cle: l.cle, libelle: libelleValeur(axe, l.cle), clients: l.n, entreprises: parCle.get(l.cle) ?? null, taux_pct: parCle.has(l.cle) ? taux(l.n, parCle.get(l.cle)!) : null })) } : {}),
  };
}

/** Ajoute `client: true` aux lignes dont le SIREN est un client. */
export async function marquerClients<T extends { siren?: unknown }>(tenantId: string, lignes: T[]): Promise<T[]> {
  const s = new Set(await sirensClients(tenantId));
  return s.size ? lignes.map((l) => (s.has(String(l.siren)) ? { ...l, client: true } : l)) : lignes;
}
