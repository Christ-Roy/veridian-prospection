/**
 * Outils MCP d'Atlas : explorer le marché (ClickHouse ODH), ranger des segments, les scorer.
 * L'espace vient de l'utilisateur (ctx.tenantId), jamais d'un argument. L'export n'est pas ici :
 * il passe par un clic humain (docs/PLAN-ATLAS.md).
 */
import { z } from "zod";

import type { ContexteOutil, Outil } from "@/lib/mcp/outils";
import { ErreurOutil } from "@/lib/mcp/erreur";
import { isRateLimited } from "@/lib/rate-limit";

import { CHAMPS, OPERATEURS } from "./champs";
import { EntreeActivitesSchema, codesParLibelle, validerActivites } from "./activites";
import { EntreeCubeSchema, entreeDepuisFiltre } from "./cube";
import { compilerMaitre } from "./maitre";
import { FiltreInvalide } from "./filtres";
import { sourceMarche } from "./source";
import { liensIA } from "@/lib/hub/liens-ia-client";

import { listerPresences } from "./presence-ia";
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
      if (e instanceof FiltreInvalide || e instanceof seg.Introuvable || e instanceof seg.Refus) throw new ErreurOutil(e.message);
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
      champs: CHAMPS.map((c) => ({ id: c.id, libelle: c.libelle, type: c.type, groupe: c.groupe, operateurs: OPERATEURS[c.type], repartition: !!c.repartition, marche: !!c.marche })),
      // Un marché (segment racine) se définit sur les champs `marche` et se compte sur toutes les entreprises
      // (analyser_marche) ; ses cibles ajoutent les autres champs, sur les fiches prospectables.
      regle: "Marché = champs « marche » (toutes les entreprises, outil analyser_marche). Cible = segment enfant, avec les autres champs (fiches prospectables).",
      exemple: { conditions: [{ champ: "departement", op: "dans", valeur: ["69"] }, { champ: "date_creation", op: "apres", valeur: "2024-01-01" }] },
    }),
  },
  {
    name: "explorer_marche",
    title: "Explorer le marché",
    description:
      "Liste et compte les FICHES PROSPECTABLES (environ 1,3 M d'entreprises contactables, non bloquées) qui répondent à un filtre ; paginé, rien n'est enregistré. " +
      "Ce n'est pas le marché : pour lister TOUTES les entreprises de France, utilisez lister_entreprises ; pour les compter par axe, analyser_marche. " +
      "Pour trouver les codes NAF d'un métier, appeler d'abord chercher_activites.",
    input: z.object({
      filtre: FILTRE,
      colonnes: z.array(z.string()).max(25).optional(),
      page: z.number().int().min(1).max(500).default(1),
      par_page: z.number().int().min(1).max(50).default(10),
    }),
    annotations: LECTURE,
    run: lisible(async (a) => {
      const s = sourceMarche();
      const [total, apercu] = await Promise.all([
        s.compter(a.filtre),
        s.apercu(a.filtre, { colonnes: (a.colonnes as string[]) ?? ["nom", "commune", "departement", "naf"], page: a.page as number, parPage: a.par_page as number }),
      ]);
      const suivante = (a.page as number) * (a.par_page as number) < total ? (a.page as number) + 1 : null;
      // Le marché entier à côté des fiches : sans lui, « 20 chasseurs » se lit comme la taille du marché.
      const { entree, ignorees } = entreeDepuisFiltre(a.filtre);
      const entier = await s
        .marche(entree)
        .then((m) => ({ entreprises_actives: m.total.entreprises, contactables: m.total.prospectables, email_envoyable: m.total.email_envoyable, conditions_non_comptees: ignorees }))
        .catch(() => null);
      return avecSource({ total, page_suivante: suivante, ...apercu, ...(entier ? { marche_entier: entier } : {}) });
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
    name: "analyser_marche",
    title: "Analyser la taille d'un marché",
    description:
      "Taille du marché ENTIER (toutes les entreprises de France, pas seulement les prospectables), d'après le cube d'ODH : " +
      "nombre d'entreprises, contacts connus (email, téléphone, site) et envoyables (ce qu'on peut promettre à un client), " +
      "au total et réparti par axe (naf, departement, forme, forme_juridique, effectif, annee_creation, statut, diffusion). " +
      "Codes NAF en LISTE (0149Z), jamais par intervalle. Passer `filtre` (celui d'un segment) le traduit sur le cube : " +
      "les conditions que le cube ne couvre pas sont rendues dans `conditions_ignorees`.",
    input: EntreeCubeSchema.extend({ filtre: FILTRE.optional() }),
    annotations: LECTURE,
    run: lisible(async (a) => {
      const { filtre, ...explicite } = a;
      const depuis = filtre ? entreeDepuisFiltre(filtre) : { entree: {}, ignorees: [] };
      const definis = Object.fromEntries(Object.entries(explicite).filter(([, v]) => v !== undefined));
      const r = await sourceMarche().marche({ ...depuis.entree, ...definis });
      return avecSource({
        ...r,
        conditions_ignorees: depuis.ignorees,
        lecture: "« connu » = contact trouvé, même écarté ensuite ; « envoyable » = ce qu'on peut promettre. Département vide = adresse non diffusée.",
      });
    }),
  },
  {
    name: "lister_entreprises",
    title: "Lister toutes les entreprises",
    description:
      "Liste et compte TOUTES les entreprises actives de France (base maître d'ODH, 30 M de SIREN), pas seulement les prospectables. " +
      "Filtrez par naf, naf_division, departement, forme_juridique, effectif, code_postal, commune (egal), date_creation, nom (contient, mots entiers " +
      "de la même famille) et par les drapeaux email, telephone, site, email_envoyable, telephone_envoyable. Aucune coordonnée n'est rendue : " +
      "seulement a_email, a_telephone, a_site et prospectable (les coordonnées d'une fiche prospectable passent par fiche_entreprise_atlas). " +
      "Les autres champs ne s'appliquent pas ici et sont rendus dans conditions_ignorees. Toujours filtrer par NAF, nom ou département + NAF.",
    input: z.object({ filtre: FILTRE, page: z.number().int().min(1).max(200).default(1), par_page: z.number().int().min(1).max(50).default(20) }),
    annotations: LECTURE,
    run: lisible(async (a) => {
      const s = sourceMarche();
      const { ignorees } = compilerMaitre(a.filtre);
      const [total, liste] = await Promise.all([s.compterMaitre(a.filtre), s.listerMaitre(a.filtre, a.page as number, a.par_page as number)]);
      const plein = liste.lignes.length === (a.par_page as number);
      return avecSource({
        total,
        ...(total === null ? { total_note: "Filtre trop large pour compter ici : affinez (NAF, nom, département) ou utilisez analyser_marche." } : {}),
        page: a.page,
        page_suivante: plein && (total === null || (a.page as number) * (a.par_page as number) < total) ? (a.page as number) + 1 : null,
        conditions_ignorees: ignorees,
        ...liste,
      });
    }),
  },
  {
    name: "chercher_activites",
    title: "Trouver les codes NAF d'un métier",
    description:
      "À appeler AVANT de définir un marché par activité. Donne, pour des mots (« chasse », « toilettage chien »), les codes NAF dont le libellé " +
      "correspond (signal libelle) ET ceux réellement portés par les entreprises dont le nom ou l'activité contient ces mots (signal usage, " +
      "par_nom), avec la taille du marché entier de chaque code. Un métier tient rarement dans un seul code : regroupez ceux qui ont du sens, " +
      "puis combinez avec une condition sur le nom si besoin. Aucune liste n'est figée : c'est à vous de juger.",
    input: EntreeActivitesSchema,
    annotations: LECTURE,
    run: lisible(async (a) => {
      const e = validerActivites(a);
      const codes = await sourceMarche().activites(e.radicaux, codesParLibelle(e.radicaux), e.limite);
      return avecSource({ mots: e.radicaux, codes, lecture: "par_nom : fiches lisibles par Atlas dont le nom ou l'activité contient les mots ; entreprises_actives : tout le marché (cube)." });
    }),
  },
  {
    name: "connexions_ia",
    title: "IA branchées",
    description: "IA (Claude, ChatGPT…) reliées au compte, avec leur dernier échange, et les liens pour en brancher une autre.",
    input: z.object({}),
    annotations: LECTURE,
    run: async (_a, c) => {
      const [connexions, liens] = await Promise.all([listerPresences(c.ctx.userId), liensIA()]);
      return { connexions, liens };
    },
  },
  {
    name: "fiche_entreprise_atlas",
    title: "Fiche d'une entreprise",
    description: "Fiche complète par SIREN : identité, activité, lieu, dirigeant, contact, web, finances, groupe, signaux, qualité.",
    input: z.object({ siren: z.string().regex(/^\d{9}$/, "SIREN à 9 chiffres") }),
    annotations: LECTURE,
    run: lisible(async (a, c) => {
      // Anti-aspiration : 60 fiches par minute et par utilisateur, écran et IA confondus.
      if (isRateLimited(`atlas-fiche:${c.ctx.userId}`, 60, 60_000)) throw new ErreurOutil("Trop de fiches ouvertes cette minute (60 au plus).");
      const f = await sourceMarche().fiche(a.siren as string);
      if (f) return avecSource({ fiche: f, base: "prospectable" });
      // Pas dans la vue prospectable : l'identité vient de la base maître, sans coordonnée.
      const m = await sourceMarche().ficheMaitre(a.siren as string);
      if (!m) throw new ErreurOutil(`Aucune entreprise avec le SIREN ${a.siren}.`);
      return avecSource({ fiche: m, base: "maitre", note: "Entreprise hors fiches prospectables : identité seulement, aucune coordonnée." });
    }),
  },
  {
    name: "points_carte",
    title: "Entreprises sur la carte d'un département",
    description: "Points géolocalisés (latitude, longitude) des entreprises d'un filtre dans un département, les mieux notées d'abord.",
    input: z.object({ filtre: FILTRE, departement: z.string().regex(/^(\d{2,3}|2A|2B)$/), limite: z.number().int().min(1).max(1000).default(400) }),
    annotations: LECTURE,
    run: lisible(async (a) => avecSource({ points: await sourceMarche().points(a.filtre, a.departement as string, a.limite as number) })),
  },
  {
    name: "lister_epingles",
    title: "Dossier de travail",
    description: "Entreprises épinglées dans le dossier de travail de l'espace (par l'utilisateur ou une IA).",
    input: z.object({}),
    annotations: LECTURE,
    run: lisible(async (_a, c) => ({ epingles: await seg.listerEpingles(c.ctx.tenantId) })),
  },
  {
    name: "epingler",
    title: "Épingler une entreprise",
    description: "Ajoute une entreprise au dossier de travail, avec une note facultative.",
    input: z.object({ siren: z.string().regex(/^\d{9}$/), nom: z.string().trim().min(1).max(200), note: z.string().max(500).optional() }),
    annotations: { ...ECRITURE, idempotentHint: true },
    visible: peutEcrire,
    run: lisible(async (a, c) => seg.epingler(c.ctx.tenantId, { siren: a.siren as string, nom: a.nom as string, note: a.note as string | undefined }, auteur(c))),
  },
  {
    name: "retirer_epingle",
    title: "Retirer une entreprise du dossier",
    description: "Retire une entreprise du dossier de travail.",
    input: z.object({ siren: z.string().regex(/^\d{9}$/) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    visible: peutEcrire,
    run: lisible(async (a, c) => seg.retirerEpingle(c.ctx.tenantId, a.siren as string)),
  },
  {
    name: "lister_segments_atlas",
    title: "Lister les dossiers et segments",
    description: "Arbre des dossiers et segments de l'espace, avec le numéro de version courant et le droit d'écriture.",
    input: z.object({}),
    annotations: LECTURE,
    run: lisible(async (_a, c) => ({ ...(await seg.listerArbre(c.ctx.tenantId)), peut_ecrire: peutEcrire(c) })),
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
  {
    name: "supprimer_segment",
    title: "Supprimer un segment",
    description:
      "Supprime un marché ou une cible de l'espace (récupérable en base). Un marché qui a des cibles n'est supprimé avec elles que si avec_cibles = true : demandez d'abord à l'utilisateur.",
    input: z.object({ segment_id: UUID, avec_cibles: z.boolean().default(false) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    visible: peutEcrire,
    run: lisible(async (a, c) => seg.supprimerSegment(c.ctx.tenantId, a.segment_id as string, a.avec_cibles as boolean)),
  },
];

export const OUTILS_ATLAS: Outil[] = OUTILS_BRUTS.map((o) => ({
  ...o,
  visible: (c: ContexteOutil) => atlasActif() && (!o.visible || o.visible(c)),
}));

