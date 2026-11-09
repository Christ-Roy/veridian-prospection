/**
 * Outils MCP d'Atlas : explorer le marché (ClickHouse ODH), ranger des segments, les scorer.
 * L'espace vient de l'utilisateur (ctx.tenantId), jamais d'un argument. L'export n'est pas ici :
 * il passe par un clic humain (docs/PLAN-ATLAS.md).
 */
import { z } from "zod";

import type { ContexteOutil, Outil } from "@/lib/mcp/outils";
import { ErreurOutil } from "@/lib/mcp/erreur";

import { CHAMPS, OPERATEURS } from "./champs";
import { FiltreInvalide } from "./filtres";
import { sourceMarche } from "./source";
import * as seg from "./segments";

const LECTURE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ECRITURE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const UUID = z.string().uuid();
const peutEcrire = (c: ContexteOutil) => c.ctx.isAdmin || c.ctx.workspaces.some((w) => w.role !== "viewer");
const auteur = (c: ContexteOutil): seg.Auteur => (c.client ? { id: `ia:${c.client}`, via: "mcp" } : { id: c.ctx.userId, via: "interface" });

/** Les erreurs métier (filtre invalide, introuvable) remontent telles quelles à l'IA, pour qu'elle corrige. */
function lisible<T>(f: (a: Record<string, unknown>, c: ContexteOutil) => Promise<T>) {
  return async (a: Record<string, unknown>, c: ContexteOutil) => {
    try {
      return await f(a, c);
    } catch (e) {
      if (e instanceof FiltreInvalide || e instanceof seg.Introuvable) throw new ErreurOutil(e.message);
      throw e;
    }
  };
}
const avecSource = <T extends object>(r: T) => ({ ...r, ...(sourceMarche().simulee ? { donnees_simulees: true } : {}) });

const FILTRE = z.object({}).passthrough().describe("Filtre : { conditions: [{ champ, op, valeur }], inclure_bloques? } (voir lister_champs)");
const SCORING = z.object({}).passthrough().describe("Scoring : { criteres: [{ champ, op, valeur, poids }] } ; score = somme des poids vrais, sur 100");

/**
 * Les outils Atlas n'apparaissent que sur la vraie source ODH : jamais de données simulées servies à une IA
 * en prod. Les tests et le dev les ouvrent avec ATLAS_SIMULE=1.
 */
export function atlasActif(env: NodeJS.ProcessEnv = process.env): boolean {
  return !sourceMarche(env).simulee || env.ATLAS_SIMULE === "1";
}

const OUTILS_BRUTS: Outil[] = [
  {
    name: "lister_champs",
    title: "Lister les champs",
    description: "Catalogue des champs (id, libellé, type, opérateurs) utilisables dans les filtres, colonnes et scorings.",
    input: z.object({}),
    annotations: LECTURE,
    run: async () => ({
      champs: CHAMPS.map((c) => ({ id: c.id, libelle: c.libelle, type: c.type, groupe: c.groupe, operateurs: OPERATEURS[c.type], repartition: !!c.repartition })),
      exemple: { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }, { champ: "date_creation", op: "apres", valeur: "2024-01-01" }] },
    }),
  },
  {
    name: "explorer_marche",
    title: "Explorer le marché",
    description: "Compte et donne un aperçu des entreprises françaises répondant à un filtre, sans rien enregistrer.",
    input: z.object({ filtre: FILTRE, colonnes: z.array(z.string()).max(25).optional(), par_page: z.number().int().min(1).max(50).default(10) }),
    annotations: LECTURE,
    run: lisible(async (a) => {
      const s = sourceMarche();
      const [total, apercu] = await Promise.all([
        s.compter(a.filtre),
        s.apercu(a.filtre, { colonnes: (a.colonnes as string[]) ?? ["nom", "commune", "departement", "naf"], page: 1, parPage: a.par_page as number }),
      ]);
      return avecSource({ total, ...apercu });
    }),
  },
  {
    name: "repartir_marche",
    title: "Répartir le marché",
    description: "Nombre d'entreprises par valeur d'un champ (département, secteur, taille…) pour un filtre : base des cartes et diagrammes.",
    input: z.object({ filtre: FILTRE, champ: z.string(), limite: z.number().int().min(1).max(200).default(30) }),
    annotations: LECTURE,
    run: lisible(async (a) => avecSource({ champ: a.champ, valeurs: await sourceMarche().repartition(a.filtre, a.champ as string, a.limite as number) })),
  },
  {
    name: "lister_segments_atlas",
    title: "Lister les dossiers et segments",
    description: "Arbre des dossiers et segments de l'espace, avec le numéro de version courant.",
    input: z.object({}),
    annotations: LECTURE,
    run: lisible(async (_a, c) => seg.listerArbre(c.ctx.tenantId)),
  },
  {
    name: "lire_segment",
    title: "Lire un segment",
    description: "Filtre, colonnes, scoring et nombre d'entreprises d'un segment (avec les conditions héritées de ses parents).",
    input: z.object({ segment_id: UUID }),
    annotations: LECTURE,
    run: lisible(async (a, c) => {
      const s = await seg.lireSegment(c.ctx.tenantId, a.segment_id as string);
      const effectif = await seg.filtreEffectif(c.ctx.tenantId, s.id);
      return avecSource({ ...s, filtre_effectif: effectif, total: await sourceMarche().compter(effectif) });
    }),
  },
  {
    name: "creer_dossier",
    title: "Créer un dossier",
    description: "Crée un dossier pour ranger des segments (ex. « Analyse marché »), éventuellement dans un dossier parent.",
    input: z.object({ nom: z.string().trim().min(1).max(120), parent_id: UUID.optional() }),
    annotations: ECRITURE,
    visible: peutEcrire,
    run: lisible(async (a, c) => seg.creerDossier(c.ctx.tenantId, a.nom as string, (a.parent_id as string) ?? null)),
  },
  {
    name: "creer_segment",
    title: "Créer un segment",
    description: "Crée un segment nommé (ex. « Éleveurs canins ») : filtre, colonnes affichées, dossier et segment parent facultatifs.",
    input: z.object({
      nom: z.string().trim().min(1).max(120),
      filtre: FILTRE,
      colonnes: z.array(z.string()).max(25).optional(),
      dossier_id: UUID.optional(),
      parent_id: UUID.optional().describe("Segment parent : ses conditions s'ajoutent"),
      note: z.string().max(300).optional(),
    }),
    annotations: ECRITURE,
    visible: peutEcrire,
    run: lisible(async (a, c) => {
      const r = await seg.creerSegment(
        c.ctx.tenantId,
        { nom: a.nom as string, filtre: a.filtre, colonnes: a.colonnes, dossierId: a.dossier_id as string, parentId: a.parent_id as string, note: a.note as string },
        auteur(c),
      );
      return avecSource({ ...r, total: await sourceMarche().compter(await seg.filtreEffectif(c.ctx.tenantId, r.id)) });
    }),
  },
  {
    name: "modifier_segment",
    title: "Modifier un segment",
    description: "Nouveau filtre (crée une version), nouveau nom ou nouvelles colonnes affichées.",
    input: z.object({ segment_id: UUID, filtre: FILTRE.optional(), nom: z.string().trim().min(1).max(120).optional(), colonnes: z.array(z.string()).max(25).optional(), note: z.string().max(300).optional() }),
    annotations: ECRITURE,
    visible: peutEcrire,
    run: lisible(async (a, c) => {
      const r = await seg.modifierSegment(c.ctx.tenantId, a.segment_id as string, { filtre: a.filtre, nom: a.nom as string, colonnes: a.colonnes, note: a.note as string }, auteur(c));
      return avecSource({ ...r, total: await sourceMarche().compter(await seg.filtreEffectif(c.ctx.tenantId, r.id)) });
    }),
  },
  {
    name: "definir_scoring",
    title: "Définir le scoring d'un segment",
    description: "Nouvelle version du scoring : critères du catalogue pondérés ; renvoie le classement obtenu (top 10).",
    input: z.object({ segment_id: UUID, scoring: SCORING, note: z.string().max(300).optional() }),
    annotations: ECRITURE,
    visible: peutEcrire,
    run: lisible(async (a, c) => {
      const r = await seg.definirScoring(c.ctx.tenantId, a.segment_id as string, a.scoring, a.note as string, auteur(c));
      const s = await seg.lireSegment(c.ctx.tenantId, r.id);
      const top = await sourceMarche().apercu(await seg.filtreEffectif(c.ctx.tenantId, r.id), { colonnes: s.colonnes, page: 1, parPage: 10, scoring: a.scoring });
      return avecSource({ ...r, top });
    }),
  },
  {
    name: "classer_segment",
    title: "Classer un segment",
    description: "Entreprises du segment triées par son scoring (ou par un champ), page par page, avec les colonnes du segment.",
    input: z.object({
      segment_id: UUID,
      page: z.number().int().min(1).max(500).default(1),
      par_page: z.number().int().min(1).max(50).default(20),
      scoring_version: z.number().int().min(1).optional().describe("Comparer une ancienne version du scoring"),
      tri: z.string().optional().describe("Champ nombre ou date, si pas de scoring"),
    }),
    annotations: LECTURE,
    run: lisible(async (a, c) => {
      const t = c.ctx.tenantId;
      const s = await seg.lireSegment(t, a.segment_id as string);
      const scoring = await seg.scoringCourant(t, s.id, a.scoring_version as number | undefined);
      const filtre = await seg.filtreEffectif(t, s.id);
      const src = sourceMarche();
      const [total, apercu] = await Promise.all([
        src.compter(filtre),
        src.apercu(filtre, { colonnes: s.colonnes, page: a.page as number, parPage: a.par_page as number, tri: a.tri as string, ...(scoring ? { scoring } : {}) }),
      ]);
      return avecSource({ total, page_suivante: (a.page as number) * (a.par_page as number) < total ? (a.page as number) + 1 : null, ...apercu });
    }),
  },
  {
    name: "historique_segment",
    title: "Historique d'un segment",
    description: "Versions du filtre et du scoring : auteur (humain ou IA), date, note.",
    input: z.object({ segment_id: UUID }),
    annotations: LECTURE,
    run: lisible(async (a, c) => seg.historique(c.ctx.tenantId, a.segment_id as string)),
  },
  {
    name: "restaurer_version_segment",
    title: "Restaurer une version",
    description: "Remet une ancienne version du filtre en créant une nouvelle version identique (rien n'est effacé).",
    input: z.object({ segment_id: UUID, version: z.number().int().min(1) }),
    annotations: ECRITURE,
    visible: peutEcrire,
    run: lisible(async (a, c) => seg.restaurerVersion(c.ctx.tenantId, a.segment_id as string, a.version as number, auteur(c))),
  },
];

export const OUTILS_ATLAS: Outil[] = OUTILS_BRUTS.map((o) => ({
  ...o,
  visible: (c: ContexteOutil) => atlasActif() && (!o.visible || o.visible(c)),
}));

