/**
 * Outils MCP d'Atlas : explorer le marché (ClickHouse ODH), ranger des segments, les scorer.
 * L'espace vient de l'utilisateur (ctx.tenantId), jamais d'un argument. L'extraction d'un segment par une IA
 * (extraire_segment) est réservée aux plans payants, bornée à 5 000 lignes par jour et par espace, et tracée
 * dans atlas_exports comme un export de l'écran (docs/PLAN-ATLAS.md).
 */
import { z } from "zod";

import type { ContexteOutil, Outil } from "@/lib/mcp/outils";
import { ErreurOutil } from "@/lib/mcp/erreur";
import { prisma } from "@/lib/prisma";
import { consommer, minuitParis, rendre } from "@/lib/compteurs";
import { isRateLimited } from "@/lib/rate-limit";

import { CHAMPS, OPERATEURS } from "./champs";
import { EntreeActivitesSchema, codesParLibelle, validerActivites } from "./activites";
import { CLIENTS_MAX, importerClients, marquerClients, penetration, retirerClients, sirensClients } from "./clients";
import { EntreeCubeSchema, entreeDepuisFiltre } from "./cube";
import { peutExporter } from "./export";
import { extraireSegment, PAGE_DEFAUT, PAGE_MAX, RefusExtraction } from "./extraction";
import { compilerMaitre } from "./maitre";
import { geometrieCommunes, rapprocher } from "./communes";
import { accorderAcces, creerCle, droits, listerAccesAvances, listerCles, RefusAcces, revoquerCle } from "./acces";
import { LIGNES_MAX_SQL, TABLES_SQL, verifierRequete } from "./sql";
import { FiltreInvalide } from "./filtres";
import { proposerPriorite } from "./suggestion";
import { sourceMarche } from "./source";
import { liensIA } from "@/lib/hub/liens-ia-client";

import { listerPresences } from "./presence-ia";
import { tournee } from "./parcours";
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
      if (e instanceof FiltreInvalide || e instanceof seg.Introuvable || e instanceof seg.Refus || e instanceof RefusAcces || e instanceof RefusExtraction) throw new ErreurOutil(e.message);
      throw e;
    }
  };
}
const avecSource = <T extends object>(r: T) => ({ ...r, ...(sourceMarche().simulee ? { donnees_simulees: true } : {}) });

/** Un client se voit, sans jamais faire échouer la lecture qui le porte. */
const marquer = <T extends { siren?: unknown }>(c: ContexteOutil, lignes: T[]) => marquerClients(c.ctx.tenantId, lignes).catch(() => lignes);
const estClient = async (c: ContexteOutil, siren: string): Promise<{ client?: true }> => ((await marquer(c, [{ siren } as { siren: string; client?: true }]))[0].client ? { client: true } : {});

const EXEMPLE_FILTRE = '{"conditions":[{"champ":"naf","op":"dans","valeur":["7500Z"]},{"champ":"departement","op":"dans","valeur":["69"]}]}';
const FILTRE = z
  .object({}, { error: `un filtre est attendu, par exemple ${EXEMPLE_FILTRE} (champs et opérateurs : lister_champs)` })
  .passthrough()
  .describe(`Conditions cumulées, par exemple ${EXEMPLE_FILTRE}. Champs, opérateurs : lister_champs. Codes NAF d'un métier : chercher_activites.`);
const AIDE_SEGMENT = "l'identifiant d'un segment est attendu : lister_segments_atlas donne ceux de l'espace, creer_segment en crée un et rend son id";
/** Segment sur lequel on agit : l'erreur dit où trouver son identifiant. */
const SEGMENT = z.string({ error: AIDE_SEGMENT }).regex(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, AIDE_SEGMENT).describe("Identifiant rendu par lister_segments_atlas ou creer_segment");
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
      champs: CHAMPS.map((c) => ({ id: c.id, libelle: c.libelle, type: c.type, groupe: c.groupe, operateurs: OPERATEURS[c.type], repartition: !!c.repartition, marche: !!c.marche, ...(c.espace ? { colonne: false } : {}) })),
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
      "Compter et lister les entreprises CONTACTABLES (prospects, 1,3 M) d'un filtre (métier, département…), sans rien enregistrer ; total, puis page par page. " +
      "Codes NAF d'un métier : chercher_activites. Toutes les entreprises de France : lister_entreprises. Garder le filtre : creer_segment.",
    input: z.object({
      filtre: FILTRE,
      colonnes: z.array(z.string()).max(25).optional(),
      page: z.number().int().min(1).max(500).default(1),
      par_page: z.number().int().min(1).max(50).default(10),
    }),
    annotations: LECTURE,
    run: lisible(async (a, c) => {
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
        .then(async (m) => {
          // Le cube ignore une condition que la base maître sait lire (le nom) : « chasseurs » rendait 15,9 M d'entreprises, celles de toute la France.
          // Le nom seul : un site ou un email est un filtre de cible, il ne définit pas le marché.
          const parNom = ignorees.filter((c) => c.champ === "nom" && c.op === "contient");
          const reste = ignorees.filter((c) => !parNom.includes(c));
          const conditions = ((a.filtre as { conditions?: unknown[] }).conditions ?? []).filter((c) => !reste.some((r) => JSON.stringify(r) === JSON.stringify(c)));
          const n = parNom.length ? await s.compterMaitre({ conditions }).catch(() => null) : null;
          return n === null
            ? { entreprises_actives: m.total.entreprises, contactables: m.total.prospectables, email_envoyable: m.total.email_envoyable, conditions_non_comptees: ignorees }
            : { entreprises_actives: n, conditions_non_comptees: reste };
        })
        .catch(() => null);
      return avecSource({ total, page_suivante: suivante, ...apercu, lignes: await marquer(c, apercu.lignes), ...(entier ? { marche_entier: entier } : {}) });
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
      "Compter combien d'entreprises : la taille du marché ENTIER (pas que les contactables), au total et par axe : naf, departement, forme, effectif, " +
      "annee_creation… Emails connus et envoyables, signaux récents. Accepte le filtre d'un segment ; rend conditions_ignorees.",
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
      "Liste TOUTES les entreprises actives de France (30 M), sans coordonnées : identité, lieu, drapeaux a_email, a_telephone, a_site, prospectable. " +
      "Toujours filtrer par NAF, nom, ou département + NAF. Les autres champs sont rendus dans conditions_ignorees.",
    input: z.object({ filtre: FILTRE, page: z.number().int().min(1).max(200).default(1), par_page: z.number().int().min(1).max(50).default(20) }),
    annotations: LECTURE,
    run: lisible(async (a, c) => {
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
        lignes: await marquer(c, liste.lignes),
      });
    }),
  },
  {
    name: "chercher_activites",
    title: "Trouver les codes NAF d'un métier",
    description:
      "Trouver un métier : ses codes NAF, décrit en quelques mots (« chasse », « toilettage chien ») : par le libellé et par le nom réel des entreprises, avec la " +
      "taille de chaque code. Un métier tient rarement dans un seul code : regroupez, et ajoutez une condition sur le nom si besoin.",
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
      const deja = await estClient(c, a.siren as string);
      if (f) return avecSource({ fiche: f, base: "prospectable", ...deja });
      // Pas dans la vue prospectable : l'identité vient de la base maître, sans coordonnée.
      const m = await sourceMarche().ficheMaitre(a.siren as string);
      if (!m) throw new ErreurOutil(`Aucune entreprise avec le SIREN ${a.siren}.`);
      return avecSource({ fiche: m, base: "maitre", ...deja, note: "Entreprise hors fiches prospectables : identité seulement, aucune coordonnée." });
    }),
  },
  {
    name: "mes_droits",
    title: "Droits de l'utilisateur dans Atlas",
    description: "Plan de l'espace, accès avancé (SQL, clés API), administration Atlas, et quota du jour de verifier_entreprises.",
    input: z.object({}),
    annotations: LECTURE,
    run: lisible(async (_a, c) => {
      // Relu en base : un plan qui vient de changer se voit tout de suite (les droits sont sinon gardés 30 s).
      const d = await droits(c.ctx.userId, c.ctx.tenantId, true);
      return {
        plan: d.plan,
        payant: !!d.payant,
        acces_avance: !!d.accesAvance,
        admin_atlas: !!d.adminAtlas,
        peut_creer_cles: !!d.accesAvance && c.ctx.isAdmin,
        quota_verification_jour: d.payant || d.accesAvance ? QUOTA_VERIFICATION.payant : QUOTA_VERIFICATION.gratuit,
      };
    }),
  },
  {
    name: "verifier_entreprises",
    title: "Vérifier une liste d'entreprises",
    description:
      "Vérifie une liste de SIREN ou SIRET (200 au plus) : nom, active ou cessée, lieu, NAF, site web, email envoyable, téléphone, logiciels vus, " +
      "contactable ou non. Introuvables et numéros invalides rendus à part. 50 par jour en gratuit, 5 000 en plan payant.",
    input: z.object({ sirens: z.array(z.string().max(40)).min(1).max(200) }),
    annotations: LECTURE,
    run: lisible(async (a, c) => {
      const { sirens, invalides } = normaliserSirens(a.sirens as string[]);
      if (!sirens.length) throw new ErreurOutil("Aucun SIREN (9 chiffres) ni SIRET (14 chiffres) reconnu.");
      const large = !!(c.droits?.payant || c.droits?.accesAvance);
      const { reste, jour } = await reserverVerification(c.ctx.tenantId, sirens.length, large ? QUOTA_VERIFICATION.payant : QUOTA_VERIFICATION.gratuit);
      const lignes = await sourceMarche()
        .verifier(sirens)
        .catch(async (e: unknown) => {
          await rendre(cleVerification(c.ctx.tenantId), jour, sirens.length); // rien vérifié, rien compté
          throw e;
        });
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
      "Colonnes des tables lisibles par requete_sql, et comment les lire (fiches contactables, base complète, cube du marché, pile logicielle).",
    input: z.object({}),
    annotations: LECTURE,
    acces: "avance",
    run: lisible(async () => ({
      lecture: {
        "odh.company_prospection_current": "fiches contactables : contacts, web, finances, signaux. Pour un envoi : deliverable = 1 AND email_envoyable = 1",
        "odh.company_master_current": "toutes les entreprises (30 M), identité et drapeaux ; filtrer d'abord sur naf_code puis department, ou sur siren",
        "odh.market_cube_current": "comptes agrégés du marché",
        "odh.company_tech_stack_current": "logiciels par SIREN : tools_fort = outils qui servent, tools_cite = seulement cités. Un outil nommé n'est pas un client (une agence publie aussi odoo)",
        "odh.web_tech_stack_current": "la preuve, par domaine",
        "odh.web_tech_stack_checked": "domaines examinés : une absence n'est une preuve que si le domaine l'a été",
        "odh.market_cube_tech_current": "entreprises par outil, NAF et département",
      },
      colonnes: await sourceMarche().schema(),
    })),
  },
  {
    name: "requete_sql",
    title: "Requête SQL en lecture sur ODH (accès avancé)",
    description:
      "Une requête SELECT (ou WITH) ClickHouse sur les tables d'ODH (voir schema_odh), 1 000 lignes au plus, 10 s, 15 M lignes lues. " +
      "Sur company_master_current, filtrer sur naf_code puis department, ou sur siren. Réglages et FORMAT refusés.",
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
      "l'en-tête Authorization: Bearer <clé> et les arguments en JSON. Affichée une seule fois : la transmettre à l'utilisateur.",
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
      "Compte le marché par commune et par intercommunalité d'un département. base « marche » : toutes les entreprises ; « prospection » : les " +
      "contactables du filtre. `repli` : marché trop large, comptes pris sur les contactables.",
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
    name: "tournee_maps",
    title: "Tournée Google Maps",
    description:
      "Ordonne des entreprises en tournée et rend les liens Google Maps à ouvrir (10 arrêts par lien, sans clé ni coût). Par défaut celles du dossier de travail, " +
      "sinon 50 SIREN au plus (par exemple les intéressés lus dans le CRM).",
    input: z.object({ sirens: z.array(z.string().regex(/^\d{9}$/)).min(1).max(50).optional() }),
    annotations: LECTURE,
    run: lisible(async (a, c) => {
      const ep = a.sirens ? null : await seg.listerEpingles(c.ctx.tenantId);
      const sirens = (a.sirens as string[] | undefined) ?? ep!.map((e) => e.siren).slice(0, 50);
      if (!sirens.length) throw new ErreurOutil("Dossier de travail vide : épinglez des entreprises, ou donnez des SIREN.");
      const arrets = await sourceMarche().positions(sirens);
      const vus = new Set(arrets.map((x) => x.siren));
      return avecSource({ ...tournee(arrets), sans_position: sirens.filter((s) => !vus.has(s)), ...(ep && ep.length > 50 ? { avertissement: "Les 50 premières du dossier seulement." } : {}) });
    }),
  },
  {
    name: "importer_clients",
    title: "Importer ses clients",
    description:
      `Marque des entreprises comme clientes de l'espace, par SIREN ou SIRET (5 000 par appel, ${CLIENTS_MAX} en tout). Sert au taux de pénétration ` +
      "(penetration_marche) et au filtre client (est true ou false). Rien n'est envoyé aux entreprises.",
    input: z.object({ numeros: z.array(z.string().max(40)).min(1).max(5000) }),
    annotations: { ...ECRITURE, idempotentHint: true },
    visible: peutEcrire,
    run: lisible(async (a, c) => importerClients(c.ctx.tenantId, auteur(c).id, a.numeros as string[])),
  },
  {
    name: "retirer_clients",
    title: "Retirer des clients",
    description: "Retire des entreprises de la liste des clients de l'espace : des numéros, ou tous avec tous = true (demandez d'abord à l'utilisateur).",
    input: z.object({ numeros: z.array(z.string().max(40)).max(5000).default([]), tous: z.boolean().default(false) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    visible: peutEcrire,
    run: lisible(async (a, c) => {
      if (!a.tous && !(a.numeros as string[]).length) throw new ErreurOutil("Donnez des numéros, ou tous = true.");
      return retirerClients(c.ctx.tenantId, a.tous ? "tous" : (a.numeros as string[]));
    }),
  },
  {
    name: "penetration_marche",
    title: "Taux de pénétration",
    description:
      "Part des entreprises actives d'un marché qui sont déjà clientes (importer_clients), au total et par département ou code NAF. Donner un filtre ou un " +
      "segment_id ; sans rien, la France entière. Rend conditions_ignorees (hors NAF, département, forme, effectif, création).",
    input: z.object({ filtre: FILTRE.optional(), segment_id: SEGMENT.optional(), axe: z.enum(["departement", "naf"]).optional() }),
    annotations: LECTURE,
    run: lisible(async (a, c) => {
      const f = a.segment_id ? await seg.filtreEffectif(c.ctx.tenantId, a.segment_id as string) : (a.filtre ?? {});
      return avecSource(await penetration(c.ctx.tenantId, f, a.axe as "departement" | "naf" | undefined));
    }),
  },
  {
    name: "clients_resume",
    title: "Clients et pénétration par marché",
    description: "Nombre de clients importés et taux de pénétration de chacun des marchés de l'espace (12 au plus).",
    input: z.object({}),
    annotations: LECTURE,
    run: lisible(async (_a, c) => {
      const total = (await sirensClients(c.ctx.tenantId)).length;
      const marches = total ? (await seg.listerArbre(c.ctx.tenantId)).segments.filter((s) => !s.parent_id).slice(0, 12) : [];
      const lignes = [];
      for (const m of marches) {
        const p = await penetration(c.ctx.tenantId, await seg.filtreEffectif(c.ctx.tenantId, m.id));
        lignes.push({ segment_id: m.id, nom: m.nom, clients: p.clients_dans_le_marche, entreprises: p.entreprises_du_marche, taux_pct: p.taux_pct, conditions_ignorees: p.conditions_ignorees.length });
      }
      return avecSource({ clients: total, maximum: CLIENTS_MAX, marches: lignes, peut_ecrire: peutEcrire(c) });
    }),
  },
  {
    name: "lister_segments_atlas",
    title: "Lister les dossiers et segments",
    description: "Arbre des dossiers et segments de l'espace, avec le numéro de version courant et le droit d'écriture.",
    input: z.object({}),
    annotations: LECTURE,
    run: lisible(async (_a, c) => {
      const arbre = await seg.listerArbre(c.ctx.tenantId);
      return {
        ...arbre,
        peut_ecrire: peutEcrire(c),
        ...(arbre.segments.length ? {} : { aide: "Aucun segment dans cet espace. Trouver un métier : chercher_activites ; compter : explorer_marche ; puis creer_segment, qui rend l'id à passer à extraire_segment." }),
      };
    }),
  },
  {
    name: "lire_segment",
    title: "Lire un segment",
    description: "Filtre, colonnes, scoring et nombre d'entreprises d'un segment (avec les conditions héritées de ses parents).",
    input: z.object({ segment_id: SEGMENT }),
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
    description: "Crée un segment nommé (ex. « Éleveurs canins ») d'après un filtre, et rend son id et son nombre d'entreprises. Comptez d'abord avec explorer_marche. Ensuite : extraire_segment pour en lire les contacts, definir_scoring pour les classer.",
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
      const total = await sourceMarche().compter(await seg.filtreEffectif(c.ctx.tenantId, r.id));
      return avecSource({
        ...r,
        total,
        ...(total
          ? { suite: "extraire_segment rend ses contacts envoyables (plans payants) ; classer_segment en donne un aperçu." }
          : { avertissement: "Aucune entreprise ne répond à ce filtre : vérifiez les valeurs (repartir_marche liste celles d'un champ), puis modifier_segment." }),
      });
    }),
  },
  {
    name: "modifier_segment",
    title: "Modifier un segment",
    description: "Nouveau filtre (crée une version), nouveau nom ou nouvelles colonnes affichées.",
    input: z.object({
      segment_id: SEGMENT,
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
    input: z.object({ segment_id: SEGMENT, scoring: SCORING, note: z.string().max(300).optional() }),
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
    name: "proposer_priorite",
    title: "Proposer des règles de priorité",
    description:
      "Propose des règles de priorité d'après les clients importés (importer_clients) : ce qui est nettement plus fréquent chez eux que dans le segment, avec les deux " +
      "pourcentages. À relire avec l'utilisateur puis à poser par definir_scoring.",
    input: z.object({ segment_id: SEGMENT }),
    annotations: LECTURE,
    run: lisible(async (a, c) => avecSource(await proposerPriorite(c.ctx.tenantId, a.segment_id as string))),
  },
  {
    name: "classer_segment",
    title: "Classer un segment",
    description: "Entreprises du segment triées par son scoring (ou par un champ), page par page, avec les colonnes du segment.",
    input: z.object({
      segment_id: SEGMENT,
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
      return avecSource({ total, page_suivante: (a.page as number) * (a.par_page as number) < total ? (a.page as number) + 1 : null, ...apercu, lignes: await marquer(c, apercu.lignes) });
    }),
  },
  {
    name: "historique_segment",
    title: "Historique d'un segment",
    description: "Versions du filtre et du scoring : auteur (humain ou IA), date, note.",
    input: z.object({ segment_id: SEGMENT }),
    annotations: LECTURE,
    run: lisible(async (a, c) => seg.historique(c.ctx.tenantId, a.segment_id as string)),
  },
  {
    name: "restaurer_version_segment",
    title: "Restaurer une version",
    description: "Remet une ancienne version du filtre en créant une nouvelle version identique (rien n'est effacé).",
    input: z.object({ segment_id: SEGMENT, version: z.number().int().min(1) }),
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
    name: "extraire_segment",
    title: "Extraire un segment, page par page",
    description:
      "Récupérer, extraire, exporter les contacts des prospects d'un segment (emails, entreprise, dirigeant) pour Notifuse, un CRM, un tableur. Sans curseur, puis " +
      "curseur_suivant jusqu'à null. Plans payants, 5 000 lignes/jour. Segment : creer_segment.",
    input: z.object({
      segment_id: SEGMENT,
      curseur: z.string().max(200).nullish().describe("curseur_suivant de la page précédente, tel quel. Absent : première page (liste figée, ni doublon ni trou ensuite)."),
      limite: z
        .number({ error: "un nombre entier de 1 à 1000 est attendu" })
        .int()
        .min(1, "au moins 1 ligne")
        .max(PAGE_MAX, `${PAGE_MAX} lignes au plus par page : prenez la suite avec curseur_suivant`)
        .default(PAGE_DEFAUT)
        .describe("30 en appel direct (au-delà la réponse est coupée : rappeler le même curseur avec une limite plus petite, rien n'est recompté) ; jusqu'à 1000 dans un programme."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: lisible(async (a, c) => {
      if (isRateLimited(`atlas-extraction:${c.ctx.tenantId}`, 60, 60_000)) throw new ErreurOutil("60 pages par minute au plus.");
      return avecSource(
        await extraireSegment(
          { tenantId: c.ctx.tenantId, userId: c.ctx.userId, client: c.client ?? null },
          { segmentId: a.segment_id as string, curseur: a.curseur as string | null | undefined, limite: a.limite as number },
        ),
      );
    }),
  },
  {
    name: "preparer_export",
    title: "Préparer un export",
    description:
      "Donne les liens de téléchargement Excel et CSV d'un segment (5 000 entreprises au plus, classées par sa priorité), à cliquer par " +
      "l'utilisateur connecté : aucune donnée n'est rendue ici (pour les lire toi-même : extraire_segment). Indique si le plan de l'espace le permet.",
    input: z.object({ segment_id: SEGMENT }),
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
    name: "creer_rapport",
    title: "Créer un rapport PDF",
    description:
      "Crée un rapport PDF d'un marché ou d'une cible : ton titre et ton analyse (texte simple), suivis des chiffres et graphiques d'Atlas (taille, départements, " +
      "activités, effectifs, créations, clients). Rend le lien à ouvrir par l'utilisateur connecté.",
    input: z.object({ segment_id: SEGMENT, titre: z.string().trim().min(1).max(120), texte: z.string().trim().max(6000).default("") }),
    annotations: ECRITURE,
    visible: peutEcrire,
    run: lisible(async (a, c) => {
      const s = await seg.lireSegment(c.ctx.tenantId, a.segment_id as string);
      const r = await prisma.atlasRapport.create({ data: { tenantId: c.ctx.tenantId, segmentId: s.id, titre: a.titre as string, texte: a.texte as string, auteur: auteur(c).id }, select: { id: true } });
      const base = (process.env.NEXTAUTH_URL || "https://prospection.app.veridian.site").replace(/\/$/, "");
      return { rapport_id: r.id, segment: s.nom, pdf: `${base}/api/atlas/rapport?id=${r.id}`, lecture: "Lien à ouvrir par l'utilisateur, connecté à Atlas. Les chiffres se relisent à chaque ouverture." };
    }),
  },
  {
    name: "supprimer_segment",
    title: "Supprimer un segment",
    description:
      "Supprime un marché ou une cible de l'espace (récupérable en base). Un marché qui a des cibles n'est supprimé avec elles que si avec_cibles = true : demandez d'abord à l'utilisateur.",
    input: z.object({ segment_id: SEGMENT, avec_cibles: z.boolean().default(false) }),
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
 * Quota de verifier_entreprises par espace et par jour (heure de Paris) : 50 SIREN en gratuit, 5 000 en payant ou en
 * accès avancé. Compté en base : il survit à un redémarrage et vaut pour toutes les instances (24/11 : en mémoire, 100
 * SIREN passaient pour un quota de 50).
 */
export const QUOTA_VERIFICATION = { gratuit: 50, payant: 5000 };
const cleVerification = (tenantId: string) => `verification:${tenantId}`;
export async function reserverVerification(tenantId: string, n: number, plafond: number): Promise<{ reste: number; jour: Date }> {
  const jour = await minuitParis();
  const r = await consommer(cleVerification(tenantId), jour, n, plafond);
  if (!r.accepte) {
    throw new ErreurOutil(
      `Quota du jour atteint : ${r.total} SIREN vérifiés sur ${plafond}, il en reste ${Math.max(0, plafond - r.total)}.` +
        (plafond === QUOTA_VERIFICATION.gratuit ? " Un plan payant en vérifie 5 000 par jour." : ""),
    );
  }
  return { reste: plafond - r.total, jour };
}

export const OUTILS_ATLAS: Outil[] = OUTILS_BRUTS.map((o) => ({
  ...o,
  visible: (c: ContexteOutil) => atlasActif() && (!o.visible || o.visible(c)),
}));

