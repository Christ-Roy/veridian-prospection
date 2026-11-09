/**
 * Dossiers, segments et scorings Atlas (pg-saas). Tout est borné au tenant : un id d'un autre
 * espace répond « introuvable ». Chaque changement de filtre ou de scoring crée une version, et
 * une version se restaure en en créant une nouvelle (l'historique ne se réécrit jamais).
 *
 * Un segment enfant hérite des conditions de toute sa chaîne de parents : le filtre effectif est
 * l'union de leurs conditions (toutes vraies à la fois).
 */
import { prisma } from "@/lib/prisma";

import { COLONNES_DEFAUT, CHAMP } from "./champs";
import { FiltreInvalide, FiltreSchema, ScoringSchema, compilerFiltre, type Filtre, type Scoring } from "./filtres";

export class Introuvable extends Error {}

export type Auteur = { id: string; via: "interface" | "mcp" };
const PROFONDEUR_MAX = 8;

function valider(filtre: unknown): Filtre {
  compilerFiltre(filtre); // messages lisibles + même contrôle que la requête
  return FiltreSchema.parse(filtre ?? {});
}
function validerColonnes(colonnes: unknown): string[] {
  if (colonnes === undefined) return COLONNES_DEFAUT;
  if (!Array.isArray(colonnes) || colonnes.length > 25 || colonnes.some((c) => typeof c !== "string" || !CHAMP.has(c))) {
    throw new FiltreInvalide("colonnes : 25 ids du catalogue au plus (outil lister_champs)");
  }
  return colonnes as string[];
}

async function segmentDuTenant(tenantId: string, segmentId: string) {
  const s = await prisma.atlasSegment.findFirst({ where: { id: segmentId, tenantId, deletedAt: null } });
  if (!s) throw new Introuvable(`segment introuvable : ${segmentId}`);
  return s;
}

export async function listerArbre(tenantId: string) {
  const [dossiers, segments] = await Promise.all([
    prisma.atlasDossier.findMany({ where: { tenantId, deletedAt: null }, orderBy: { nom: "asc" } }),
    prisma.atlasSegment.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { nom: "asc" },
      include: { versions: { select: { numero: true }, orderBy: { numero: "desc" }, take: 1 }, scorings: { select: { numero: true }, orderBy: { numero: "desc" }, take: 1 } },
    }),
  ]);
  return {
    dossiers: dossiers.map((d) => ({ id: d.id, nom: d.nom, parent_id: d.parentId })),
    segments: segments.map((s) => ({
      id: s.id,
      nom: s.nom,
      dossier_id: s.dossierId,
      parent_id: s.parentId,
      version: s.versions[0]?.numero ?? 0,
      scoring: s.scorings[0]?.numero ?? null,
    })),
  };
}

export async function creerDossier(tenantId: string, nom: string, parentId?: string | null) {
  if (parentId && !(await prisma.atlasDossier.findFirst({ where: { id: parentId, tenantId, deletedAt: null } }))) {
    throw new Introuvable(`dossier parent introuvable : ${parentId}`);
  }
  const d = await prisma.atlasDossier.create({ data: { tenantId, nom: nom.trim().slice(0, 120), parentId: parentId ?? null } });
  return { id: d.id, nom: d.nom, parent_id: d.parentId };
}

export async function creerSegment(
  tenantId: string,
  a: { nom: string; dossierId?: string | null; parentId?: string | null; filtre?: unknown; colonnes?: unknown; note?: string },
  auteur: Auteur,
) {
  const filtre = valider(a.filtre);
  const colonnes = validerColonnes(a.colonnes);
  if (a.dossierId && !(await prisma.atlasDossier.findFirst({ where: { id: a.dossierId, tenantId, deletedAt: null } }))) {
    throw new Introuvable(`dossier introuvable : ${a.dossierId}`);
  }
  if (a.parentId) await segmentDuTenant(tenantId, a.parentId);
  const s = await prisma.atlasSegment.create({
    data: {
      tenantId,
      nom: a.nom.trim().slice(0, 120),
      dossierId: a.dossierId ?? null,
      parentId: a.parentId ?? null,
      colonnes,
      versions: { create: { numero: 1, filtre, auteur: auteur.id, via: auteur.via, note: a.note ?? null } },
    },
  });
  return { id: s.id, nom: s.nom, version: 1 };
}

/** Nouvelle version du filtre (et/ou renommage, colonnes). Ne crée une version que si le filtre change. */
export async function modifierSegment(
  tenantId: string,
  segmentId: string,
  a: { nom?: string; filtre?: unknown; colonnes?: unknown; note?: string },
  auteur: Auteur,
) {
  const s = await segmentDuTenant(tenantId, segmentId);
  const data: { nom?: string; colonnes?: string[] } = {};
  if (a.nom) data.nom = a.nom.trim().slice(0, 120);
  if (a.colonnes !== undefined) data.colonnes = validerColonnes(a.colonnes);
  if (Object.keys(data).length) await prisma.atlasSegment.update({ where: { id: s.id }, data });
  if (a.filtre === undefined) return { id: s.id, version: (await versionCourante(s.id)).numero };
  const filtre = valider(a.filtre);
  return prisma.$transaction(async (tx) => {
    const der = await tx.atlasSegmentVersion.findFirst({ where: { segmentId: s.id }, orderBy: { numero: "desc" } });
    const numero = (der?.numero ?? 0) + 1;
    await tx.atlasSegmentVersion.create({ data: { segmentId: s.id, numero, filtre, auteur: auteur.id, via: auteur.via, note: a.note ?? null } });
    return { id: s.id, version: numero };
  });
}

async function versionCourante(segmentId: string) {
  const v = await prisma.atlasSegmentVersion.findFirst({ where: { segmentId }, orderBy: { numero: "desc" } });
  if (!v) throw new Introuvable("segment sans version");
  return v;
}

/** Filtre effectif : conditions du segment et de toute sa chaîne de parents. */
export async function filtreEffectif(tenantId: string, segmentId: string, version?: number): Promise<Filtre> {
  const conditions: Filtre["conditions"] = [];
  let inclureBloques = false;
  let courant: string | null = segmentId;
  for (let profondeur = 0; courant; profondeur++) {
    if (profondeur > PROFONDEUR_MAX) throw new FiltreInvalide("chaîne de segments parents trop profonde ou en boucle");
    const s = await segmentDuTenant(tenantId, courant);
    const v =
      profondeur === 0 && version !== undefined
        ? await prisma.atlasSegmentVersion.findUnique({ where: { segmentId_numero: { segmentId: s.id, numero: version } } })
        : await versionCourante(s.id);
    if (!v) throw new Introuvable(`version ${version} introuvable`);
    const f = FiltreSchema.parse(v.filtre);
    conditions.push(...f.conditions);
    if (profondeur === 0) inclureBloques = f.inclure_bloques;
    courant = s.parentId;
  }
  if (conditions.length > 40) throw new FiltreInvalide("plus de 40 conditions avec les segments parents");
  return { conditions, inclure_bloques: inclureBloques };
}

export async function lireSegment(tenantId: string, segmentId: string) {
  const s = await segmentDuTenant(tenantId, segmentId);
  const [v, sc] = await Promise.all([
    versionCourante(s.id),
    prisma.atlasScoringVersion.findFirst({ where: { segmentId: s.id }, orderBy: { numero: "desc" } }),
  ]);
  return {
    id: s.id,
    nom: s.nom,
    dossier_id: s.dossierId,
    parent_id: s.parentId,
    colonnes: s.colonnes as string[],
    version: v.numero,
    filtre: v.filtre as Filtre,
    scoring: sc ? { version: sc.numero, criteres: (sc.criteres as Scoring).criteres } : null,
  };
}

export async function historique(tenantId: string, segmentId: string) {
  const s = await segmentDuTenant(tenantId, segmentId);
  const [versions, scorings] = await Promise.all([
    prisma.atlasSegmentVersion.findMany({ where: { segmentId: s.id }, orderBy: { numero: "desc" }, take: 50 }),
    prisma.atlasScoringVersion.findMany({ where: { segmentId: s.id }, orderBy: { numero: "desc" }, take: 50 }),
  ]);
  const ligne = (v: { numero: number; auteur: string; via: string; note: string | null; createdAt: Date }) => ({
    version: v.numero,
    auteur: v.auteur,
    via: v.via,
    note: v.note,
    date: v.createdAt.toISOString(),
  });
  return { filtre: versions.map((v) => ({ ...ligne(v), filtre: v.filtre })), scoring: scorings.map((v) => ({ ...ligne(v), criteres: v.criteres })) };
}

/** Restaure une version du filtre en créant une nouvelle version identique. */
export async function restaurerVersion(tenantId: string, segmentId: string, numero: number, auteur: Auteur) {
  const s = await segmentDuTenant(tenantId, segmentId);
  const v = await prisma.atlasSegmentVersion.findUnique({ where: { segmentId_numero: { segmentId: s.id, numero } } });
  if (!v) throw new Introuvable(`version ${numero} introuvable`);
  return modifierSegment(tenantId, s.id, { filtre: v.filtre, note: `restauration de la v${numero}` }, auteur);
}

export async function definirScoring(tenantId: string, segmentId: string, scoring: unknown, note: string | undefined, auteur: Auteur) {
  const s = await segmentDuTenant(tenantId, segmentId);
  compilerFiltre({}, scoring); // messages lisibles
  const criteres = ScoringSchema.parse(scoring);
  return prisma.$transaction(async (tx) => {
    const der = await tx.atlasScoringVersion.findFirst({ where: { segmentId: s.id }, orderBy: { numero: "desc" } });
    const numero = (der?.numero ?? 0) + 1;
    await tx.atlasScoringVersion.create({ data: { segmentId: s.id, numero, criteres, auteur: auteur.id, via: auteur.via, note: note ?? null } });
    return { id: s.id, scoring: numero };
  });
}

export async function scoringCourant(tenantId: string, segmentId: string, version?: number): Promise<Scoring | null> {
  const s = await segmentDuTenant(tenantId, segmentId);
  const v = version
    ? await prisma.atlasScoringVersion.findUnique({ where: { segmentId_numero: { segmentId: s.id, numero: version } } })
    : await prisma.atlasScoringVersion.findFirst({ where: { segmentId: s.id }, orderBy: { numero: "desc" } });
  if (version && !v) throw new Introuvable(`scoring v${version} introuvable`);
  return v ? ScoringSchema.parse(v.criteres) : null;
}

export async function supprimerSegment(tenantId: string, segmentId: string) {
  const s = await segmentDuTenant(tenantId, segmentId);
  await prisma.atlasSegment.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
  return { id: s.id, supprime: true };
}
