/**
 * Extraction paginée d'un segment par une IA (VER-242, Robert 24/11), pour alimenter Notifuse sans fichier à la main.
 *
 * Curseur stable : à la première page, la liste ordonnée des SIREN envoyables est figée en base. Les pages
 * suivantes la découpent, donc ni doublon ni trou quand le segment change ou qu'ODH publie une release entre
 * deux appels. Les coordonnées ne sont pas copiées : chaque page relit ODH, et une fiche qui n'est plus
 * envoyable (piège, cessée, email retiré) est rendue dans `retires`, sans ses coordonnées. Lignes et retirés
 * réunis valent toujours exactement la page figée.
 *
 * Quota : 5 000 lignes par jour (Paris) et par espace, lu dans le journal atlas_exports sous un verrou Postgres.
 * Il survit à un redémarrage et vaut pour toutes les instances. Une page déjà servie se rejoue à l'identique sans
 * être recomptée, et se relit par morceaux plus petits au même curseur : une réponse
 * directe est coupée à 15 000 caractères (une trentaine de lignes, protocole.ts), un programme du Hub reçoit 1 000 lignes.
 */
import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";

import { peutExporter } from "./export";
import * as seg from "./segments";
import { sourceMarche, type LigneExtraite } from "./source";

export const QUOTA_EXTRACTION_JOUR = 5000;
export const PAGE_MAX = 1000;
/** Sûr en appel direct (réponse coupée à 15 000 caractères, SORTIE_MAX de protocole.ts). */
export const PAGE_DEFAUT = 30;
/** Un curseur vit une semaine : sept jours de quota, donc au plus 35 000 lignes par extraction. */
const DUREE_JOURS = 7;
export const LIGNES_MAX_EXTRACTION = QUOTA_EXTRACTION_JOUR * DUREE_JOURS;

export class RefusExtraction extends Error {}

export type PageExtraite = {
  lignes: LigneExtraite[];
  /** SIREN de la page qui ne sont plus envoyables depuis le début de l'extraction. */
  retires: string[];
  curseur_suivant: string | null;
  total: number;
  quota_restant_aujourdhui: number;
  extraction: { segment_version: number; version_odh: string; commencee_le: string; expire_le: string };
  tronque?: { total_segment: number };
};

type Appelant = { tenantId: string; userId: string; client: string | null };

export const encoderCurseur = (extractionId: string, debut: number) => Buffer.from(`${extractionId}.${debut}`).toString("base64url");
export function decoderCurseur(c: string): { extractionId: string; debut: number } | null {
  const m = Buffer.from(c, "base64url").toString("utf8").match(/^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.(\d{1,6})$/);
  return m ? { extractionId: m[1], debut: Number(m[2]) } : null;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Un seul appel à la fois par espace décide d'une extraction ou d'une page (toutes instances confondues). */
async function verrouiller(tx: Tx, tenantId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`atlas-extraction:${tenantId}`}, 0))::text AS v`;
}
const debutJour = async (tx: Tx): Promise<Date> =>
  (await tx.$queryRaw<{ j: Date }[]>`SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris') AS j`)[0].j;

async function consommeAujourdhui(tx: Tx, tenantId: string): Promise<number> {
  const jour = await debutJour(tx);
  const r = await tx.atlasExport.aggregate({ _sum: { lignes: true }, where: { tenantId, canal: "mcp", creeLe: { gte: jour } } });
  return r._sum.lignes ?? 0;
}

const messageQuota = `Quota du jour atteint : ${QUOTA_EXTRACTION_JOUR} lignes extraites pour cet espace. Reprenez après minuit (heure de Paris) avec le même curseur.`;

/** L'extraction du jour de cette définition de segment, sinon une nouvelle, figée maintenant. */
async function extractionCourante(a: Appelant, segmentId: string) {
  const s = await seg.lireSegment(a.tenantId, segmentId);
  const [filtre, scoring] = await Promise.all([seg.filtreEffectif(a.tenantId, s.id), seg.scoringCourant(a.tenantId, s.id)]);
  const empreinte = createHash("sha256").update(JSON.stringify({ filtre, scoring })).digest("hex");
  const duJour = async (tx: Tx) =>
    tx.atlasExtraction.findFirst({
      where: { tenantId: a.tenantId, segmentId: s.id, empreinte, creeLe: { gte: await debutJour(tx) }, expireLe: { gt: new Date() } },
      orderBy: { creeLe: "desc" },
    });
  const connue = await duJour(prisma as unknown as Tx);
  if (connue) return connue;

  const liste = await sourceMarche().sirensEnvoyables(filtre, scoring, LIGNES_MAX_EXTRACTION);
  return prisma.$transaction(async (tx) => {
    await verrouiller(tx, a.tenantId);
    // Deux premières pages simultanées : la seconde reprend la liste de la première.
    const entretemps = await duJour(tx);
    if (entretemps) return entretemps;
    await tx.atlasExtraction.deleteMany({ where: { tenantId: a.tenantId, expireLe: { lt: new Date() } } });
    return tx.atlasExtraction.create({
      data: {
        tenantId: a.tenantId, segmentId: s.id, segmentVersion: s.version, empreinte, userId: a.userId, client: a.client,
        versionOdh: liste.version, sirens: liste.sirens, totalSegment: liste.total,
        expireLe: new Date(Date.now() + DUREE_JOURS * 24 * 3600 * 1000),
      },
    });
  });
}

/**
 * Taille de la page demandée. Déjà comptée (une page du journal contient ce début) : relue telle quelle, ou en
 * partie si la limite est plus petite, sans rien recompter. Sinon elle doit prolonger la dernière, et se compte.
 */
async function reserverPage(a: Appelant, e: { id: string; segmentId: string; segmentVersion: number; sirens: string[] }, debut: number, limite: number) {
  return prisma.$transaction(async (tx) => {
    await verrouiller(tx, a.tenantId);
    const reste = Math.max(0, QUOTA_EXTRACTION_JOUR - (await consommeAujourdhui(tx, a.tenantId)));
    const derniere = await tx.atlasExport.findFirst({ where: { extractionId: e.id, debut: { lte: debut } }, orderBy: { debut: "desc" } });
    const fin = derniere ? (derniere.debut ?? 0) + derniere.lignes : 0;
    if (debut < fin) return { taille: Math.min(limite, fin - debut), reste };
    if (debut > fin) throw new RefusExtraction("Curseur invalide.");
    const taille = Math.min(limite, e.sirens.length - debut, reste);
    if (taille <= 0) {
      if (debut < e.sirens.length) throw new RefusExtraction(messageQuota);
      return { taille: 0, reste };
    }
    await tx.atlasExport.create({
      data: {
        tenantId: a.tenantId, userId: a.userId, client: a.client, canal: "mcp", format: "json",
        segmentId: e.segmentId, segmentVersion: e.segmentVersion, extractionId: e.id, debut, lignes: taille,
      },
    });
    return { taille, reste: reste - taille };
  });
}

export async function extraireSegment(a: Appelant, p: { segmentId: string; curseur?: string | null; limite: number }): Promise<PageExtraite> {
  // Relu en base à chaque page : un espace qui perd son plan payant s'arrête là.
  const t = await prisma.tenant.findUnique({ where: { id: a.tenantId }, select: { plan: true } });
  if (!peutExporter(t?.plan)) throw new RefusExtraction("L'extraction est réservée aux plans payants Veridian, comme l'export. mes_droits donne le plan de l'espace ; explorer_marche compte sans plan payant.");

  let debut = 0;
  let e;
  if (p.curseur) {
    const c = decoderCurseur(p.curseur);
    e = c && (await prisma.atlasExtraction.findFirst({ where: { id: c.extractionId, tenantId: a.tenantId, segmentId: p.segmentId } }));
    if (!c || !e) throw new RefusExtraction("Curseur invalide pour ce segment : passez le curseur_suivant de la page précédente tel quel, ou aucun curseur pour reprendre du début.");
    if (e.expireLe < new Date()) throw new RefusExtraction("Curseur expiré (7 jours) : relancez l'extraction sans curseur.");
    await seg.lireSegment(a.tenantId, p.segmentId); // un segment supprimé ne s'extrait plus
    debut = c.debut;
  } else {
    e = await extractionCourante(a, p.segmentId);
  }

  const { taille, reste } = await reserverPage(a, e, debut, Math.min(PAGE_MAX, Math.max(1, Math.trunc(p.limite))));
  const page = e.sirens.slice(debut, debut + taille);
  const lues = new Map((await sourceMarche().extraire(page)).map((l) => [l.siren, l]));
  const fin = debut + taille;
  return {
    lignes: page.flatMap((x) => lues.get(x) ?? []),
    retires: page.filter((x) => !lues.has(x)),
    curseur_suivant: fin < e.sirens.length ? encoderCurseur(e.id, fin) : null,
    total: e.sirens.length,
    quota_restant_aujourdhui: reste,
    extraction: { segment_version: e.segmentVersion, version_odh: e.versionOdh, commencee_le: e.creeLe.toISOString(), expire_le: e.expireLe.toISOString() },
    ...(e.totalSegment > e.sirens.length ? { tronque: { total_segment: e.totalSegment } } : {}),
  };
}
