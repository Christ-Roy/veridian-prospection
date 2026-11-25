/**
 * Taille du marché : le cube d'ODH (ODH-0245, odh.market_cube_current) compte TOUTES les entreprises de
 * France par case (NAF, département, forme, effectif, année de création, statut), là où la vue de
 * prospection ne garde que les fiches non bloquées. C'est l'étape « analyse du marché » du flux.
 *
 * Règles d'ODH (09/11) : sélection par LISTE de codes NAF et `naf_rev2 = 1`, jamais d'intervalle de
 * chaînes (il ramasse des codes NAF 1993) ; `department = ''` = inconnu (diffusion partielle, adresse
 * masquée), `'99'` = étranger. « Connu » (nb_avec_*) compte tout contact trouvé ; « envoyable »
 * (nb_*_livrable, nb_prospectables) est ce qu'on peut promettre à un client.
 */
import { z } from "zod";

import { motsCles } from "./activites";
import { conditionNom, TABLE_MAITRE } from "./maitre";
import { FiltreInvalide, FiltreSchema, type Condition, type SqlParam } from "./filtres";
import { DEPARTMENT_NAMES } from "@/components/dashboard/france-map-data";

import { NAF_LIBELLES, normaliserNaf } from "./naf";

export const TABLE_CUBE = "odh.market_cube_current";

const DEP = /^(\d{2,3}|2A|2B)$/;

/** Axes de répartition du cube → colonne. */
export const AXES_CUBE = {
  naf: "naf_code",
  departement: "department",
  forme: "forme_type",
  forme_juridique: "legal_form",
  effectif: "tranche_effectif",
  annee_creation: "annee_creation",
  statut: "statut",
  diffusion: "diffusion",
} as const;
export type AxeCube = keyof typeof AXES_CUBE;

export const EntreeCubeSchema = z.object({
  naf: z.array(z.string()).max(200).optional().describe("Codes NAF de sous-classe (0149Z ou 01.49Z)"),
  divisions: z.array(z.string().regex(/^\d{2}$/)).max(100).optional().describe("Divisions NAF entières (2 chiffres, ex. 01)"),
  departements: z.array(z.string().regex(DEP)).max(110).optional(),
  formes: z.array(z.enum(["entreprise_individuelle", "societe", "autre", "inconnu"])).optional(),
  formes_juridiques: z.array(z.string().regex(/^\d{4}$/)).max(100).optional().describe("Catégories juridiques à 4 chiffres"),
  effectifs: z.array(z.string().regex(/^(NN|\d{2})$/)).max(20).optional().describe("Tranches d'effectif SIRENE (NN, 00, 01…53)"),
  creation_min: z.number().int().min(1800).max(2100).optional(),
  creation_max: z.number().int().min(1800).max(2100).optional(),
  noms: z.array(z.string().regex(/^[a-z0-9]{2,40}$/)).max(5).optional().describe("Radicaux de mots du nom (chass, veterin) : tous présents ; compté sur la base complète, sans signaux"),
  statut: z.enum(["actif", "ferme", "tous"]).default("actif"),
  axe: z.enum(Object.keys(AXES_CUBE) as [AxeCube, ...AxeCube[]]).optional(),
  limite: z.number().int().min(1).max(500).default(120),
});
export type EntreeCube = z.input<typeof EntreeCubeSchema>;

const MESURES = `sum(nb_entreprises) AS entreprises,
  sum(nb_avec_email) AS email_connu, sum(nb_avec_telephone) AS telephone_connu, sum(nb_avec_site) AS site_connu,
  sum(nb_avec_un_canal) AS un_canal_connu, sum(nb_prospectables) AS prospectables,
  sum(nb_email_livrable) AS email_envoyable, sum(nb_telephone_livrable) AS telephone_envoyable,
  sum(nb_sig_90j) AS signal_90j, sum(nb_sig_365j) AS signal_365j, sum(nb_sig_dirigeant_90j) AS signal_dirigeant_90j,
  sum(nb_sig_etablissement_90j) AS signal_etablissement_90j, sum(nb_sig_siege_90j) AS signal_siege_90j,
  sum(nb_sig_capital_90j) AS signal_capital_90j, sum(nb_sig_ca_hausse_365j) AS signal_ca_hausse_365j`;
// Signaux d'évolution (ODH-0272, cube v5, 17/11) : entreprises qui ont « bougé », comptées une fois par mesure, sur
// toutes les entreprises de l'instantané. Un signal est un motif d'appel, jamais un critère d'exclusion.
export const COLONNES_MESURES = [
  "entreprises", "email_connu", "telephone_connu", "site_connu", "un_canal_connu", "prospectables", "email_envoyable", "telephone_envoyable",
  "signal_90j", "signal_365j", "signal_dirigeant_90j", "signal_etablissement_90j", "signal_siege_90j", "signal_capital_90j", "signal_ca_hausse_365j",
] as const;
type Signal = Extract<(typeof COLONNES_MESURES)[number], `signal_${string}`>;
/** Les signaux n'existent que dans le cube : absents d'un marché défini par le nom, jamais rendus à zéro. */
export type Mesures = Record<Exclude<(typeof COLONNES_MESURES)[number], Signal>, number> & Partial<Record<Signal, number>>;

/**
 * Le cube n'a pas les noms : un marché défini par un nom se compte sur la base maître (30 M, index de mots). Même colonnes,
 * trois expressions près.
 */
const MESURES_MAITRE = `count() AS entreprises, countIf(has_email = 1) AS email_connu, countIf(has_phone = 1) AS telephone_connu,
  countIf(has_site = 1) AS site_connu, countIf(has_email = 1 OR has_phone = 1) AS un_canal_connu, countIf(prospectable = 1) AS prospectables,
  countIf(email_envoyable = 1 AND prospectable = 1) AS email_envoyable, countIf(telephone_envoyable = 1 AND prospectable = 1) AS telephone_envoyable`;
const ANNEE_MAITRE = "ifNull(toYear(creation_date), 0)";
const STATUT_MAITRE = "if(administrative_status = 'A', 'actif', 'ferme')";
const AXES_MAITRE: Record<string, string> = { ...AXES_CUBE, annee_creation: ANNEE_MAITRE, statut: STATUT_MAITRE };

/** Requêtes paramétrées du cube : total (avec provenance) et, si un axe est demandé, la répartition. */
export function compilerCube(brut: unknown): { total: string; repartition: string | null; params: Record<string, SqlParam>; entree: z.output<typeof EntreeCubeSchema> } {
  const r = EntreeCubeSchema.safeParse(brut ?? {});
  if (!r.success) throw new FiltreInvalide(r.error.issues.map((i) => `${i.path.join(".") || "entrée"} : ${i.message}`).join(" ; "));
  const e = r.data;
  const params: Record<string, SqlParam> = {};
  const parNom = !!e.noms?.length;
  const ANNEE = parNom ? ANNEE_MAITRE : "annee_creation";
  // Sans code NAF demandé, une entreprise à l'ancienne nomenclature porte le nom cherché tout autant.
  const where = parNom && !e.naf && !e.divisions ? [] : ["naf_rev2 = 1"];
  const liste = (nom: string, col: string, v?: string[]) => {
    if (!v) return;
    // Une liste vide (deux conditions sans valeur commune) ne sélectionne rien, jamais tout le marché.
    if (!v.length) return void where.push("0");
    params[nom] = { type: "Array(String)", valeur: [...new Set(v)] };
    where.push(`${col} IN {${nom}:Array(String)}`);
  };
  if (e.naf) {
    const codes = e.naf.map((c) => {
      const n = normaliserNaf(c);
      if (!n) throw new FiltreInvalide(`naf : « ${c} » n'est pas un code de sous-classe (ex. 0149Z)`);
      return n;
    });
    liste("naf", "naf_code", codes);
  }
  liste("div", "substring(naf_code, 1, 2)", e.divisions);
  liste("dep", "department", e.departements);
  liste("forme", "forme_type", e.formes);
  liste("fj", "legal_form", e.formes_juridiques);
  liste("eff", "tranche_effectif", e.effectifs);
  if (e.creation_min !== undefined) {
    params.amin = { type: "UInt16", valeur: e.creation_min };
    where.push(`${ANNEE} >= {amin:UInt16}`);
  }
  if (e.creation_max !== undefined) {
    params.amax = { type: "UInt16", valeur: e.creation_max };
    where.push(`${ANNEE} <= {amax:UInt16}`);
  }
  if (e.statut !== "tous") {
    params.statut = { type: "String", valeur: e.statut };
    where.push(`${parNom ? STATUT_MAITRE : "statut"} = {statut:String}`);
  }
  e.noms?.forEach((m, i) => where.push(conditionNom(m, `nom${i}`, params)));
  const w = where.join(" AND ");
  if (parNom) {
    return {
      total: `SELECT ${MESURES_MAITRE} FROM ${TABLE_MAITRE} WHERE ${w}`,
      repartition: e.axe ? `SELECT toString(${AXES_MAITRE[e.axe]}) AS cle, ${MESURES_MAITRE} FROM ${TABLE_MAITRE} WHERE ${w} GROUP BY cle ORDER BY entreprises DESC, cle LIMIT ${e.limite}` : null,
      params,
      entree: e,
    };
  }
  const total = `SELECT ${MESURES}, max(cube_version) AS cube_version, max(built_at) AS calcule_le, max(src_prospection_version) AS version_prospection FROM ${TABLE_CUBE} WHERE ${w}`;
  const repartition = e.axe
    ? `SELECT toString(${AXES_CUBE[e.axe]}) AS cle, ${MESURES} FROM ${TABLE_CUBE} WHERE ${w} GROUP BY cle ORDER BY entreprises DESC, cle LIMIT ${e.limite}`
    : null;
  return { total, repartition, params, entree: e };
}

/** Tranches d'effectif SIRENE (salariés). */
export const TRANCHES: Record<string, string> = {
  NN: "Non renseignée", "00": "0 salarié", "01": "1 ou 2", "02": "3 à 5", "03": "6 à 9", "11": "10 à 19", "12": "20 à 49",
  "21": "50 à 99", "22": "100 à 199", "31": "200 à 249", "32": "250 à 499", "41": "500 à 999", "42": "1 000 à 1 999",
  "51": "2 000 à 4 999", "52": "5 000 à 9 999", "53": "10 000 et plus",
};
export const MOTS: Record<string, string> = {
  entreprise_individuelle: "Entreprise individuelle", societe: "Société", autre: "Autre", inconnu: "Inconnu",
  actif: "Active", ferme: "Fermée", diffusible: "Diffusible", partielle: "Diffusion partielle", non_diffusible: "Non diffusible", inconnue: "Inconnue",
};

/** Libellé lisible d'une valeur d'axe (la forme juridique est nommée par la source, qui connaît les codes). */
export function libelleCube(axe: AxeCube, cle: string): string {
  if (axe === "naf") return NAF_LIBELLES[cle] ?? cle;
  if (axe === "departement") return cle === "" ? "Département inconnu (adresse non diffusée)" : cle === "99" ? "Étranger" : (DEPARTMENT_NAMES[cle] ?? cle);
  if (axe === "effectif") return TRANCHES[cle] ?? cle;
  if (MOTS[cle]) return MOTS[cle];
  if (axe === "annee_creation") return cle === "0" ? "Année inconnue" : cle;
  return cle === "" ? "Inconnu" : cle;
}

/**
 * Ce qu'un filtre Atlas devient sur le cube. Le cube n'a que ses axes : toute autre condition (site, email,
 * score…) est rendue dans `ignorees`, pour que l'écran et l'IA disent honnêtement ce que le chiffre couvre.
 */
export function entreeDepuisFiltre(brut: unknown): { entree: EntreeCube; ignorees: Condition[] } {
  const f = FiltreSchema.parse(brut ?? {});
  const entree: EntreeCube = {};
  const ignorees: Condition[] = [];
  const valeurs = (c: Condition) => (Array.isArray(c.valeur) ? c.valeur.map(String) : typeof c.valeur === "string" ? [c.valeur] : []);
  const intersecter = (a: string[] | undefined, b: string[]) => (a ? a.filter((x) => b.includes(x)) : b);
  for (const c of f.conditions) {
    const v = valeurs(c);
    if (c.op === "dans" && v.length) {
      if (c.champ === "naf") { entree.naf = intersecter(entree.naf, v); continue; }
      if (c.champ === "naf_division") { entree.divisions = intersecter(entree.divisions, v); continue; }
      if (c.champ === "departement") { entree.departements = intersecter(entree.departements, v); continue; }
      if (c.champ === "forme_juridique") { entree.formes_juridiques = intersecter(entree.formes_juridiques, v); continue; }
      if (c.champ === "effectif") { entree.effectifs = intersecter(entree.effectifs, v); continue; }
    }
    if (c.champ === "nom" && c.op === "contient" && typeof c.valeur === "string") {
      const r = motsCles(c.valeur);
      const tous = [...new Set([...(entree.noms ?? []), ...r])];
      if (r.length && tous.length <= 5) { entree.noms = tous; continue; }
    }
    if (c.champ === "date_creation" && typeof c.valeur === "string" && /^\d{4}-01-01$/.test(c.valeur)) {
      const an = Number(c.valeur.slice(0, 4));
      if (c.op === "apres") { entree.creation_min = Math.max(entree.creation_min ?? an, an); continue; }
      if (c.op === "avant") { entree.creation_max = Math.min(entree.creation_max ?? an - 1, an - 1); continue; }
    }
    ignorees.push(c);
  }
  return { entree, ignorees };
}

export type ResultatCube = {
  total: Mesures;
  axe: AxeCube | null;
  lignes: (Mesures & { cle: string; libelle: string })[];
  provenance: { cube_version: string; calcule_le: string; version_prospection: string } | null;
};

export const mesures = (l: Record<string, unknown>): Mesures =>
  Object.fromEntries(COLONNES_MESURES.filter((m) => !m.startsWith("signal_") || l[m] !== undefined).map((m) => [m, Number(l[m] ?? 0)])) as Mesures;
