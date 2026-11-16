/**
 * Outils MCP d'Atlas : explorer le marché (ClickHouse ODH), ranger des segments, les scorer.
 * L'espace vient de l'utilisateur (ctx.tenantId), jamais d'un argument. L'export n'est pas ici :
 * il passe par un clic humain (docs/PLAN-ATLAS.md).
 */
import { z } from "zod";

import type { ContexteOutil, Outil } from "@/lib/mcp/outils";
import { ErreurOutil } from "@/lib/mcp/erreur";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";

import { CHAMPS, OPERATEURS } from "./champs";
import { EntreeActivitesSchema, codesParLibelle, validerActivites } from "./activites";
import { EntreeCubeSchema, entreeDepuisFiltre } from "./cube";
import { peutExporter } from "./export";
import { compilerMaitre } from "./maitre";
import { geometrieCommunes, rapprocher } from "./communes";
import { accorderAcces, creerCle, listerAccesAvances, listerCles, RefusAcces, revoquerCle } from "./acces";
import { LIGNES_MAX_SQL, TABLES_SQL, verifierRequete } from "./sql";
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
      if (e instanceof FiltreInvalide || e instanceof seg.Introuvable || e instanceof seg.Refus || e instanceof RefusAcces) throw new ErreurOutil(e.message);
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
    name: "mes_droits",
    title: "Droits de l'utilisateur dans Atlas",
    description: "Plan de l'espace, accès avancé (SQL, clés API), administration Atlas, et quota du jour de verifier_entreprises.",
    input: z.object({}),
    annotations: LECTURE,
    run: lisible(async (_a, c) => ({
      plan: c.droits?.plan ?? null,
      payant: !!c.droits?.payant,
      acces_avance: !!c.droits?.accesAvance,
      admin_atlas: !!c.droits?.adminAtlas,
      peut_creer_cles: !!c.droits?.accesAvance && c.ctx.isAdmin,
      quota_verification_jour: c.droits?.payant || c.droits?.accesAvance ? QUOTA_VERIFICATION.payant : QUOTA_VERIFICATION.gratuit,
    })),
  },
  {
    name: "verifier_entreprises",
    title: "Vérifier une liste d'entreprises",
    description:
      "Pour une liste de SIREN ou SIRET (200 au plus, collés tels quels) : nom, active ou cessée, commune, NAF, site web (adresse quand " +
      "elle est publiée, sinon a_site), email envoyable, téléphone utilisable, et si la fiche est contactable dans Atlas. Les introuvables " +
      "et les numéros invalides sont rendus à part. 50 SIREN par jour en gratuit, 5 000 en plan payant.",
    input: z.object({ sirens: z.array(z.string().max(40)).min(1).max(200) }),
    annotations: LECTURE,
    run: lisible(async (a, c) => {
      const { sirens, invalides } = normaliserSirens(a.sirens as string[]);
      if (!sirens.length) throw new ErreurOutil("Aucun SIREN (9 chiffres) ni SIRET (14 chiffres) reconnu.");
      const large = !!(c.droits?.payant || c.droits?.accesAvance);
      const reste = reserverVerification(c.ctx.tenantId, sirens.length, large ? QUOTA_VERIFICATION.payant : QUOTA_VERIFICATION.gratuit);
      const lignes = await sourceMarche().verifier(sirens);
      return avecSource({
        entreprises: lignes,
        resume: {
          demandees: sirens.length,
          trouvees: lignes.filter((l) => l.trouvee).length,
          avec_site: lignes.filter((l) => l.a_site).length,
          email_envoyable: lignes.filter((l) => l.email_envoyable).length,
          contactables: lignes.filter((l) => l.contactable).length,
        },
        ...(invalides.length ? { invalides } : {}),
        quota_restant_aujourdhui: reste,
      });
    }),
  },
  {
    name: "schema_odh",
    title: "Tables et colonnes d'ODH (accès avancé)",
    description:
      `Colonnes des tables lisibles par requete_sql : ${TABLES_SQL.join(", ")}. company_prospection_current : fiches contactables ` +
      "(contacts, web, finances, signaux) ; company_master_current : toutes les entreprises (30 M, identité et drapeaux, filtrer d'abord " +
      "sur naf_code et department) ; market_cube_current : comptes agrégés du marché.",
    input: z.object({}),
    annotations: LECTURE,
    acces: "avance",
    run: lisible(async () => ({ colonnes: await sourceMarche().schema() })),
  },
  {
    name: "requete_sql",
    title: "Requête SQL en lecture sur ODH (accès avancé)",
    description:
      `Une requête SELECT (ou WITH) ClickHouse sur ${TABLES_SQL.join(", ")}, ${LIGNES_MAX_SQL} lignes au plus. Limites du compte : ` +
      "10 s, 15 M lignes lues. Sur company_master_current, filtrez sur naf_code puis department (ordre de tri) ou sur siren (index). " +
      "Paramètres, réglages et FORMAT refusés. Voir schema_odh pour les colonnes.",
    input: z.object({ requete: z.string().min(1).max(8000), limite: z.number().int().min(1).max(LIGNES_MAX_SQL).default(200) }),
    annotations: LECTURE,
    acces: "avance",
    run: lisible(async (a, c) => {
      if (isRateLimited(`atlas-sql:${c.ctx.tenantId}`, 30, 60_000)) throw new ErreurOutil("30 requêtes SQL par minute au plus.");
      const sql = verifierRequete(a.requete as string, a.limite as number);
      const t0 = Date.now();
      try {
        const r = await sourceMarche().sql(sql);
        console.log(`[atlas] sql espace=${c.ctx.tenantId} user=${c.ctx.userId} lignes=${r.lignes.length} ms=${Date.now() - t0} q=${JSON.stringify((a.requete as string).slice(0, 300))}`);
        return { ...r, nombre: r.lignes.length, tronque: r.lignes.length >= (a.limite as number) };
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        // Erreur de ClickHouse : rendue lisible à l'IA (syntaxe, colonne inconnue, limite dépassée), sans la pile.
        throw new ErreurOutil(m.replace(/^ClickHouse \d+ : /, "").replace(/\s*\(version[\s\S]*$/, "").slice(0, 400));
      }
    }),
  },
  {
    name: "lister_cles_api",
    title: "Clés API de l'espace (accès avancé)",
    description: "Clés API de l'espace : nom, début de la clé, auteur, dernière utilisation, révocation. La clé elle-même n'est jamais relisible.",
    input: z.object({}),
    annotations: LECTURE,
    acces: "avance",
    run: lisible(async (_a, c) => ({ cles: await listerCles(c.ctx.tenantId) })),
  },
  {
    name: "creer_cle_api",
    title: "Créer une clé API (accès avancé)",
    description:
      "Crée une clé pour appeler les outils Atlas depuis un script : POST https://prospection.app.veridian.site/api/atlas/<outil> avec " +
      "l'en-tête Authorization: Bearer <clé> et les arguments en JSON. La clé n'est affichée qu'une fois : la transmettre à l'utilisateur.",
    input: z.object({ nom: z.string().trim().min(1).max(80) }),
    annotations: { ...ECRITURE, idempotentHint: false },
    acces: "avance",
    visible: (c) => c.ctx.isAdmin,
    run: lisible(async (a, c) => creerCle(c.ctx, a.nom as string)),
  },
  {
    name: "revoquer_cle_api",
    title: "Révoquer une clé API (accès avancé)",
    description: "Révoque une clé de l'espace : elle cesse de marcher tout de suite.",
    input: z.object({ cle_id: z.string().uuid() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    acces: "avance",
    visible: (c) => c.ctx.isAdmin,
    run: lisible(async (a, c) => revoquerCle(c.ctx.tenantId, a.cle_id as string)),
  },
  {
    name: "accorder_acces_avance",
    title: "Accorder ou retirer l'accès avancé (administrateur Atlas)",
    description:
      "Donne (actif = true) ou retire (false) l'accès avancé (SQL sur ODH, clés API) à l'espace dont l'adresse est propriétaire. " +
      "Retirer révoque aussi toutes ses clés.",
    input: z.object({ email: z.string().email(), actif: z.boolean() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    acces: "admin",
    run: lisible(async (a, c) => accorderAcces(c.ctx.userId, a.email as string, a.actif as boolean)),
  },
  {
    name: "lister_acces_avances",
    title: "Espaces à accès avancé (administrateur Atlas)",
    description: "Les espaces qui ont l'accès avancé, avec l'adresse de leur propriétaire.",
    input: z.object({}),
    annotations: LECTURE,
    acces: "admin",
    run: lisible(async (_a, c) => ({ espaces: await listerAccesAvances(c.ctx.userId) })),
  },
  {
    name: "repartir_communes",
    title: "Marché par commune et intercommunalité d'un département",
    description:
      "Compte le marché commune par commune dans un département (code INSEE, nom), et par intercommunalité (métropole, " +
      "communauté de communes ou d'agglomération : code SIREN, nom, communes). base « marche » : toutes les entreprises actives " +
      "(entreprises, contactables, email_envoyable, telephone_envoyable) ; base « prospection » : les fiches prospectables du filtre " +
      "(avec en plus sans_site et avec_email). `repli` : marché trop large pour la base complète, comptes pris sur les fiches prospectables.",
    input: z.object({ filtre: FILTRE, departement: z.string().regex(/^(\d{2}|2A|2B)$/), base: z.enum(["marche", "prospection"]).default("marche") }),
    annotations: LECTURE,
    run: lisible(async (a) => {
      const dep = a.departement as string;
      const brutes = await sourceMarche().communes(a.filtre, dep, a.base as "marche" | "prospection");
      const geo = await geometrieCommunes(dep).catch(() => null);
      const r = geo
        ? rapprocher(geo.communes, brutes, geo.epcis)
        : { communes: brutes.lignes.map((l) => ({ code: l.insee ?? l.nom, nom: l.nom, mesures: l.mesures })), intercommunalites: [], non_rapprochees: {} };
      return avecSource({ base: brutes.base, repli: brutes.repli, departement: dep, ...r });
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
    description: "Ajoute une entreprise au dossier de travail, avec une note facultative. Le nom est retrouvé par le SIREN s'il n'est pas donné.",
    input: z.object({ siren: z.string().regex(/^\d{9}$/), nom: z.string().trim().min(1).max(200).optional(), note: z.string().max(500).optional() }),
    annotations: { ...ECRITURE, idempotentHint: true },
    visible: peutEcrire,
    run: lisible(async (a, c) => {
      let nom = a.nom as string | undefined;
      if (!nom) {
        // L'IA n'a pas à recopier le nom : on le lit (fiche prospectable, sinon base maître).
        const f = (await sourceMarche().fiche(a.siren as string)) ?? (await sourceMarche().ficheMaitre(a.siren as string));
        nom = typeof f?.identite?.nom === "string" ? f.identite.nom : undefined;
        if (!nom) throw new ErreurOutil(`Aucune entreprise avec le SIREN ${a.siren}.`);
      }
      return seg.epingler(c.ctx.tenantId, { siren: a.siren as string, nom, note: a.note as string | undefined }, auteur(c));
    }),
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
    input: z.object({
      segment_id: UUID,
      filtre: FILTRE.optional(),
      nom: z.string().trim().min(1).max(120).optional(),
      colonnes: z.array(z.string()).max(25).optional(),
      dossier_id: UUID.nullable().optional().describe("Ranger le marché dans ce dossier ; null = sans dossier"),
      note: z.string().max(300).optional(),
    }),
    annotations: ECRITURE,
    visible: peutEcrire,
    run: lisible(async (a, c) => {
      const r = await seg.modifierSegment(c.ctx.tenantId, a.segment_id as string, { filtre: a.filtre, nom: a.nom as string, colonnes: a.colonnes, note: a.note as string, dossierId: a.dossier_id as string | null | undefined }, auteur(c));
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
    name: "renommer_dossier",
    title: "Renommer un dossier",
    description: "Change le nom d'un dossier de l'espace.",
    input: z.object({ dossier_id: UUID, nom: z.string().trim().min(1).max(120) }),
    annotations: { ...ECRITURE, idempotentHint: true },
    visible: peutEcrire,
    run: lisible(async (a, c) => seg.renommerDossier(c.ctx.tenantId, a.dossier_id as string, a.nom as string)),
  },
  {
    name: "supprimer_dossier",
    title: "Supprimer un dossier",
    description: "Supprime un dossier ; ses marchés et sous-dossiers ne sont jamais supprimés avec lui, ils remontent d'un niveau.",
    input: z.object({ dossier_id: UUID }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    visible: peutEcrire,
    run: lisible(async (a, c) => seg.supprimerDossier(c.ctx.tenantId, a.dossier_id as string)),
  },
  {
    name: "preparer_export",
    title: "Préparer un export",
    description:
      "Donne les liens de téléchargement Excel et CSV d'un segment (5 000 entreprises au plus, classées par sa priorité), à cliquer par " +
      "l'utilisateur connecté : aucune donnée n'est rendue ici, l'export reste un geste humain. Indique si le plan de l'espace le permet.",
    input: z.object({ segment_id: UUID }),
    annotations: LECTURE,
    run: lisible(async (a, c) => {
      const s = await seg.lireSegment(c.ctx.tenantId, a.segment_id as string);
      const t = await prisma.tenant.findUnique({ where: { id: c.ctx.tenantId }, select: { plan: true } });
      const base = (process.env.NEXTAUTH_URL || "https://prospection.app.veridian.site").replace(/\/$/, "");
      const lien = (f: string) => `${base}/api/atlas/export?segment_id=${s.id}&format=${f}`;
      return {
        segment: s.nom,
        autorise: peutExporter(t?.plan),
        ...(peutExporter(t?.plan) ? { excel: lien("xlsx"), csv: lien("csv") } : { message: "L'export est réservé aux plans payants Veridian." }),
        lecture: "Liens à ouvrir par l'utilisateur, connecté à Atlas dans son navigateur.",
      };
    }),
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

/** SIREN ou SIRET collés tels quels (espaces, points) → SIREN à 9 chiffres ; le reste est rendu à part. */
export function normaliserSirens(entrees: readonly string[]): { sirens: string[]; invalides: string[] } {
  const sirens: string[] = [];
  const invalides: string[] = [];
  for (const e of entrees) {
    const c = String(e).replace(/[\s.\-]/g, "");
    if (/^\d{9}$/.test(c)) sirens.push(c);
    else if (/^\d{14}$/.test(c)) sirens.push(c.slice(0, 9));
    else if (c) invalides.push(String(e));
  }
  return { sirens: [...new Set(sirens)], invalides };
}

/**
 * Quota de verifier_entreprises par espace et par jour (heure de Paris) : 50 SIREN en gratuit, 5 000 en payant
 * ou en accès avancé. Compté en mémoire : un redémarrage le remet à zéro, c'est un fusible, pas une facture.
 */
export const QUOTA_VERIFICATION = { gratuit: 50, payant: 5000 };
const verifies = new Map<string, { jour: string; n: number }>();
export function reserverVerification(tenantId: string, n: number, plafond: number, maintenant = new Date()): number {
  const jour = maintenant.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
  const v = verifies.get(tenantId);
  const deja = v?.jour === jour ? v.n : 0;
  const reste = Math.max(0, plafond - deja);
  if (n > reste) throw new ErreurOutil(`Quota du jour atteint : ${deja} SIREN vérifiés sur ${plafond}, il en reste ${reste}.` + (plafond === QUOTA_VERIFICATION.gratuit ? " Un plan payant en vérifie 5 000 par jour." : ""));
  verifies.set(tenantId, { jour, n: deja + n });
  return reste - n;
}

export const OUTILS_ATLAS: Outil[] = OUTILS_BRUTS.map((o) => ({
  ...o,
  visible: (c: ContexteOutil) => atlasActif() && (!o.visible || o.visible(c)),
}));

