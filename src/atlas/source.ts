/**
 * Source des données marché d'Atlas. En prod : ClickHouse ODH en lecture seule (compte prospection_ro,
 * vue odh.company_prospection_current). Sans CLICKHOUSE_PASSWORD (dev, tests, avant la création du
 * compte) : source simulée déterministe, signalée par `simulee: true` dans chaque réponse.
 */
import { CHAMP, CHAMPS, type Champ } from "./champs";
import { motifMot, type CodeActivite } from "./activites";
import type { Arret } from "./parcours";
import { clientsCourants } from "./clients-portee";
import { COLONNES_MAITRE, TABLE_MAITRE, compilerMaitre, conditionNom } from "./maitre";
import { compilerCube, libelleCube, mesures, TABLE_CUBE, type ResultatCube } from "./cube";
import { libelleValeur } from "./libelles";
import { NAF_LIBELLES } from "./naf";
import { TABLES_SQL } from "./sql";
import { parmiSirens, FiltreInvalide, FiltreSchema, ScoringSchema, colonnesSql, compilerFiltre, type Condition, type SqlParam } from "./filtres";

export type Ligne = Record<string, string | number | boolean | null>;
export type Apercu = { colonnes: string[]; page: number; parPage: number; tri: string; lignes: Ligne[] };
/** Options d'aperçu ; avec `scoring`, chaque ligne a une colonne `score` (0-100) et le tri se fait dessus. */
export type OptionsApercu = { colonnes: string[]; page: number; parPage: number; tri?: string; sens?: "asc" | "desc"; scoring?: unknown; /** lignes par page au plus (100 pour l'écran, l'export en demande plus) */ plafond?: number; /** export : jamais une fiche non livrable */ livrablesSeuls?: boolean };

/** Fiche complète d'une entreprise : colonnes ODH renommées en français, regroupées par thème. */
export type Fiche = Record<string, Record<string, string | number | boolean | null | string[]>>;
/**
 * Comptes par commune. Base « marche » : la base maître, sans code INSEE, regroupée par nom et code postal.
 * Base « prospection » : les fiches prospectables, par code INSEE. `repli` : le marché était trop large pour la
 * base maître, les comptes viennent des fiches prospectables.
 */
export type CommunesBrutes = {
  base: "marche" | "prospection";
  repli: boolean;
  lignes: { insee: string | null; nom: string; code_postal: string | null; mesures: Record<string, number> }[];
};
/** Ligne d'extraire_segment : de quoi écrire un mail, rien de plus. */
export type LigneExtraite = {
  siren: string;
  email: string;
  domaine: string | null;
  raison_sociale: string;
  dirigeant: string | null;
  role_dirigeant: string | null;
  activite: string | null;
  naf: string | null;
  code_postal: string | null;
  commune: string | null;
  departement: string | null;
  telephone: string | null;
};
/** Une fiche pour le CRM : identité, et coordonnées seulement si elles sont utilisables (appel, email). */
export type LigneCrm = Omit<LigneExtraite, "email"> & { email: string | null };
/** Recherche d'une entreprise, sans aucune coordonnée. */
export type Recherche = ({ siren: string } | { domaine: string } | { mots: string[] }) & { codePostal: string | null; limite: number };
export type Trouvee = {
  siren: string; nom: string; enseigne: string | null; commune: string | null; code_postal: string | null; departement: string | null;
  naf: string | null; activite: string | null; effectif: string | null; date_creation: string | null; active: boolean; prospectable: boolean; site: string | null;
};
/** Ligne de verifier_entreprises : ce qu'on sait d'une entreprise, en un coup d'œil. */
export type Verification = {
  siren: string;
  trouvee: boolean;
  nom: string | null;
  active: boolean | null;
  commune: string | null;
  departement: string | null;
  naf: string | null;
  /** Adresse du site quand ODH la publie, sinon null ; `a_site` dit s'il y en a un. */
  site: string | null;
  a_site: boolean | null;
  email_envoyable: boolean | null;
  telephone_utilisable: boolean | null;
  /** Fiche contactable dans Atlas (ciblable, exportable). */
  contactable: boolean;
  /** Logiciels qui servent, d'après ODH (pile logicielle) ; vide si rien de vu (ce qui ne prouve pas l'absence), null si la pile est illisible. */
  logiciels: string[] | null;
  /**
   * Grande entreprise : `site` est un site lié qui publie le SIREN, pas forcément le site officiel (un groupe en a
   * plusieurs, ODH choisit mal le principal : Danone → eveprogramme.com, 17/11). Retiré quand ODH aura corrigé.
   */
  site_incertain?: boolean;
};
export type Point = { siren: string; nom: string; commune: string; lat: number; lon: number; email: boolean; site: boolean };

/** Colonnes de la fiche : thème → (clé française → colonne ODH). Liste blanche, comme le catalogue. */
/**
 * Envoyable = adresse valable (email_envoyable) ET fiche livrable (deliverable) : ODH, 17/11, 180 632 fiches cessées,
 * en procédure ou pièges à spam avaient la première sans la seconde. Le motif dit alors pourquoi la fiche est bloquée.
 */
const ENVOYABLE_EMAIL = "(email_envoyable = 1 AND deliverable = 1)";
const ENVOYABLE_TELEPHONE = "(telephone_envoyable = 1 AND deliverable = 1)";
const MOTIF_EMAIL = "if(deliverable = 0 AND motif_email_non_envoyable = '', blocking_reasons[1], motif_email_non_envoyable)";

/** Vue d'ODH de la pile logicielle (ODH-0263) : une ligne par SIREN. */
export const TABLE_LOGICIELS = "odh.company_tech_stack_current";

export const FICHE: Record<string, Record<string, string>> = {
  identite: { siren: "siren", nom: "legal_name", forme_juridique: "legal_form", categorie: "company_category", date_creation: "creation_date", capital: "share_capital", statut: "administrative_status", procedure: "procedure_status", date_procedure: "procedure_date" },
  activite: { naf: "naf_code", secteur: "activity_sector", activite: "activity_label", services: "activity_services", idcc: "idcc_label", opco: "opco_name" },
  lieu: { commune: "city", code_postal: "postal_code", departement: "department", commune_insee: "commune_insee", latitude: "latitude", longitude: "longitude" },
  dirigeant: { nom: "director_name", role: "director_role", email: "director_email", email_verifie: "director_email_verified" },
  contact: { email: "email", type_email: "email_type", verification: "email_verification", preuve: "email_verification_basis", email_envoyable: ENVOYABLE_EMAIL, motif_email: MOTIF_EMAIL, telephone_envoyable: ENVOYABLE_TELEPHONE, messagerie: "mail_provider_group", telephone: "phone", delivrable: "deliverable" },
  web: { site: "primary_domain", domaines: "domains", niveau: "web_tier", obsolete: "website_obsolete", https: "has_https", responsive: "has_responsive", outil: "cms", ecommerce: "is_ecommerce", plateforme_ecommerce: "ecom_platform" },
  finances: { chiffre_affaires: "revenue", resultat_net: "net_income", ebe: "ebe", tresorerie_nette: "net_cash", annee: "financials_year", croissance_pct: "revenue_growth_pct", tendance: "revenue_trend", effectif: "headcount_value", taille: "size_band" },
  groupe: { maison_mere: "parent_name", filiales: "subsidiaries_count", tete_de_groupe: "group_root_name", taille_groupe: "group_size" },
  evolutions: { dernier: "sig_last_type", date_dernier: "sig_last_on", types_12_mois: "sig_types_365d", nombre_12_mois: "sig_count_365d", recents: "JSONExtractRaw(attributes_json, 'signals', 'events')" },
  signaux: { rge: "label_rge", qualiopi: "label_qualiopi", bio: "label_bio", ess: "label_ess", marches_publics: "public_contracts_count", montant_marches: "public_contracts_amount", permis_3_ans: "pub_permits_3y_count", aides_minimis: "pub_minimis_count" },
  qualite: { score_odh: "priority_score_v2", grade: "lead_grade", confiance: "confidence_tier", blocages: "blocking_reasons" },
};

export interface SourceMarche {
  readonly simulee: boolean;
  fiche(siren: string): Promise<Fiche | null>;
  points(filtre: unknown, departement: string, limite?: number): Promise<Point[]>;
  /** Vérification par lot : une ligne par SIREN demandé (fiche contactable, sinon base complète, sinon introuvable). */
  verifier(sirens: readonly string[]): Promise<Verification[]>;
  /** SIREN envoyables par email d'un filtre, dans l'ordre de la priorité ; au plus `plafond` (extraire_segment). */
  sirensEnvoyables(filtre: unknown, scoring: unknown, plafond: number): Promise<{ sirens: string[]; total: number; version: string }>;
  /** Coordonnées de ces SIREN, relues maintenant : ceux qui ne sont plus envoyables n'y sont pas. */
  extraire(sirens: readonly string[]): Promise<LigneExtraite[]>;
  /** Fiche prospectable pour le CRM, null sinon. Sans email utilisable, elle reste envoyable (appel à froid). */
  pourCrm(siren: string): Promise<LigneCrm | null>;
  /** Toutes les entreprises de France par nom, SIREN ou domaine : actives et prospectables d'abord. */
  chercher(r: Recherche): Promise<Trouvee[]>;
  /** Parmi ces SIREN, combien d'entreprises actives d'un filtre de marché (base maître), au total ou par axe. */
  compterParmi(filtre: unknown, sirens: readonly string[], axe?: "departement" | "naf"): Promise<{ total: number; lignes: { cle: string; n: number }[] }>;
  /** Position des entreprises d'une tournée : celles qui n'en ont pas n'y sont pas. */
  positions(sirens: readonly string[]): Promise<Arret[]>;
  /** Accès avancé : requête SQL déjà passée par verifierRequete (sql.ts). */
  sql(requete: string): Promise<{ colonnes: string[]; lignes: Ligne[] }>;
  /** Colonnes des tables autorisées au SQL. */
  schema(): Promise<{ table: string; colonne: string; type: string }[]>;
  /** Comptes par commune d'un département, bruts (rapprochés des contours par communes.ts). */
  communes(filtre: unknown, departement: string, base: "marche" | "prospection"): Promise<CommunesBrutes>;
  compter(filtre: unknown): Promise<number>;
  apercu(filtre: unknown, o: OptionsApercu): Promise<Apercu>;
  repartition(filtre: unknown, champ: string, limite?: number): Promise<{ cle: string; nombre: number }[]>;
  /** Taille du marché entier, d'après le cube d'ODH (voir cube.ts). */
  marche(entree: unknown): Promise<ResultatCube>;
  /** Base maître : nombre d'entreprises (null si le filtre est trop large pour le compte) et liste paginée. */
  compterMaitre(filtre: unknown): Promise<number | null>;
  listerMaitre(filtre: unknown, page: number, parPage: number): Promise<{ colonnes: string[]; lignes: Ligne[] }>;
  /** Identité d'une entreprise d'après la base maître (sans contact), pour une fiche non prospectable. */
  ficheMaitre(siren: string): Promise<Fiche | null>;
  /** Codes NAF d'un métier : par libellé et par usage réel (voir activites.ts). */
  activites(radicaux: readonly string[], codesLibelle: readonly string[], limite: number): Promise<CodeActivite[]>;
}

const TABLE = "odh.company_prospection_current";

/** Champ de tri : nombre ou date du catalogue, score ODH par défaut. */
function champTri(id = "score_odh"): Champ {
  const c = CHAMP.get(id);
  if (!c || (c.type !== "nombre" && c.type !== "date")) throw new FiltreInvalide(`tri impossible sur « ${id} » (nombre ou date)`);
  return c;
}
function champRepartition(id: string): Champ {
  const c = CHAMP.get(id);
  if (!c?.repartition) {
    throw new FiltreInvalide(`répartition impossible sur « ${id} » (${CHAMPS.filter((x) => x.repartition).map((x) => x.id).join(", ")})`);
  }
  return c;
}

/** Valeur d'un paramètre au format texte attendu par l'interface HTTP de ClickHouse. */
export function valeurParam(p: SqlParam): string {
  const echapper = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(p.valeur)) return `[${p.valeur.map((v) => echapper(String(v))).join(",")}]`;
  return String(p.valeur);
}

/**
 * File d'attente des requêtes ClickHouse : le profil prospection_ro accepte 4 requêtes simultanées pour
 * TOUTE l'app ; un écran en lance plus d'un coup (compte, aperçu, répartition, points). On en garde au
 * plus `max` en vol par conteneur, les autres attendent leur tour.
 */
export class FileAttente {
  private enVol = 0;
  private readonly attente: (() => void)[] = [];
  constructor(readonly max: number) {}
  get actives() {
    return this.enVol;
  }
  async executer<T>(f: () => Promise<T>): Promise<T> {
    if (this.enVol >= this.max) await new Promise<void>((r) => this.attente.push(r));
    this.enVol++;
    try {
      return await f();
    } finally {
      this.enVol--;
      this.attente.shift()?.();
    }
  }
}

export const MESSAGE_SANS_FILTRE = "Pour lister les entreprises, précisez une activité (NAF), un nom ou un département : les totaux de la France entière sont dans analyser_marche.";
export const MESSAGE_TROP_LARGE = "Filtre trop large pour lister ici : ajoutez une activité (NAF) ou un nom.";
/** Limites du compte dépassées (lignes lues, durée, octets) : un filtre trop large, pas une panne. */
const LIMITE_DEPASSEE = /Code: (158|159|307)\b|TOO_MANY_ROWS|TIMEOUT_EXCEEDED|TOO_MANY_BYTES/;
const TROP_DE_REQUETES = /TOO_MANY_SIMULTANEOUS_QUERIES|Code: 202\b/;

export class SourceClickHouse implements SourceMarche {
  readonly simulee = false;
  constructor(
    private readonly cfg: { url: string; user: string; password: string },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly file = new FileAttente(3),
    private readonly pauseMs = 250,
  ) {}

  /** Une requête refusée faute de place (code 202) est rejouée deux fois au plus, avec une courte pause. */
  private async requete<T>(sql: string, params: Record<string, SqlParam>): Promise<T[]> {
    for (let essai = 0; ; essai++) {
      try {
        return await this.file.executer(() => this.envoyer<T>(sql, params));
      } catch (e) {
        if (essai >= 2 || !(e instanceof Error) || !TROP_DE_REQUETES.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, this.pauseMs * (essai + 1)));
      }
    }
  }

  private async envoyer<T>(sql: string, params: Record<string, SqlParam>): Promise<T[]> {
    const u = new URL(this.cfg.url);
    // Aucun réglage dans l'URL : le profil prospection_ro impose lecture seule, 10 s, 15 M lignes lues
    // et 200 000 lignes de résultat, et refuse toute modification de réglage par requête.
    for (const [nom, p] of Object.entries(params)) u.searchParams.set(`param_${nom}`, valeurParam(p));
    const res = await this.fetchImpl(u, {
      method: "POST",
      headers: { "X-ClickHouse-User": this.cfg.user, "X-ClickHouse-Key": this.cfg.password, "Content-Type": "text/plain" },
      body: `${sql} FORMAT JSON`,
      signal: AbortSignal.timeout(15_000),
    });
    const texte = await res.text();
    if (!res.ok) throw new Error(`ClickHouse ${res.status} : ${texte.slice(0, 200)}`);
    return (JSON.parse(texte) as { data: T[] }).data;
  }

  async marche(entree: unknown): Promise<ResultatCube> {
    const c = compilerCube(entree);
    const [total, rep] = await Promise.all([
      this.requete<Record<string, unknown>>(c.total, c.params),
      c.repartition ? this.requete<Record<string, unknown>>(c.repartition, c.params) : Promise.resolve([]),
    ]);
    const t = total[0] ?? {};
    const axe = c.entree.axe ?? null;
    return {
      total: mesures(t),
      axe,
      lignes: axe
        ? rep.map((l) => ({ cle: String(l.cle), libelle: axe === "forme_juridique" ? (formeJuridique(l.cle) ?? "Inconnue") : libelleCube(axe, String(l.cle)), ...mesures(l) }))
        : [],
      provenance: t.cube_version ? { cube_version: String(t.cube_version), calcule_le: String(t.calcule_le), version_prospection: String(t.version_prospection) } : null,
    };
  }

  async activites(radicaux: readonly string[], codesLibelle: readonly string[], limite: number): Promise<CodeActivite[]> {
    // Base maître (30 M, toutes les entreprises actives), par les mots entiers de chaque famille dans l'index de
    // noms d'ODH : 0,5 à 0,7 s mesurés (14/11), là où l'expression régulière sur la vue prospectable frôlait 10 s.
    const params: Record<string, SqlParam> = {};
    const conds = radicaux.map((m, i) => conditionNom(m, `m${i}`, params));
    const usage = await this.requete<{ naf: string; n: string }>(
      `SELECT naf_code AS naf, count() AS n FROM ${TABLE_MAITRE} WHERE administrative_status = 'A' AND naf_rev2 = 1 AND ${conds.join(" AND ")} GROUP BY naf ORDER BY n DESC, naf LIMIT ${Math.min(40, Math.max(1, limite))}`,
      params,
    );
    const parNom = new Map(usage.map((u) => [u.naf, Number(u.n)]));
    const codes = [...new Set([...codesLibelle, ...parNom.keys()])].filter((c) => /^\d{4}[A-Z]$/.test(c));
    if (!codes.length) return [];
    const cube = await this.requete<Record<string, unknown>>(
      `SELECT naf_code AS naf, sum(nb_entreprises) AS entreprises, sum(nb_prospectables) AS contactables, sum(nb_email_livrable) AS email
       FROM ${TABLE_CUBE} WHERE naf_rev2 = 1 AND statut = 'actif' AND naf_code IN {codes:Array(String)} GROUP BY naf`,
      { codes: { type: "Array(String)", valeur: codes } },
    );
    const parCode = new Map(cube.map((l) => [String(l.naf), l]));
    const libelles = new Set(codesLibelle);
    return codes
      .map((c) => ({
        naf: c,
        libelle: NAF_LIBELLES[c] ?? c,
        signaux: [...(libelles.has(c) ? (["libelle"] as const) : []), ...(parNom.has(c) ? (["usage"] as const) : [])],
        par_nom: parNom.get(c) ?? 0,
        entreprises_actives: Number(parCode.get(c)?.entreprises ?? 0),
        contactables: Number(parCode.get(c)?.contactables ?? 0),
        email_envoyable: Number(parCode.get(c)?.email ?? 0),
      }))
      .sort((a, b) => Number(b.signaux.includes("libelle")) - Number(a.signaux.includes("libelle")) || b.par_nom - a.par_nom || b.entreprises_actives - a.entreprises_actives)
      .slice(0, limite);
  }

  async compterMaitre(filtre: unknown): Promise<number | null> {
    const c = compilerMaitre(filtre);
    if (!c.filtre) return null; // sans filtre : 30 M de lignes, au-delà du compte ; le cube donne le total
    try {
      const r = await this.requete<{ n: string }>(`SELECT count() AS n FROM ${TABLE_MAITRE} WHERE ${c.where}`, c.params);
      return Number(r[0]?.n ?? 0);
    } catch (e) {
      // Filtre trop large pour les 15 M lignes du compte : on le dit plutôt que d'échouer.
      if (e instanceof Error && LIMITE_DEPASSEE.test(e.message)) return null;
      throw e;
    }
  }

  async listerMaitre(filtre: unknown, page: number, parPage: number) {
    const c = compilerMaitre(filtre);
    const n = Math.min(100, Math.max(1, Math.trunc(parPage)));
    const p = Math.max(1, Math.trunc(page));
    const cols = Object.entries(COLONNES_MAITRE).map(([id, col]) => `${col} AS ${id}`);
    // Tri par pertinence d'ODH (rank) : par SIREN, « chasseurs » sortait d'abord des syndics de copropriété.
    // Mesuré le 14/11 : 0,5 à 0,8 s, même sur un NAF de 262 000 entreprises. Sans filtre, ou si le filtre est
    // trop large pour trier tout le résultat dans les limites du compte, aucun tri : l'ordre physique de la table
    // (rangée par NAF et département, pas par SIREN) ne lit que la page ; un tri par SIREN lirait les 30 M.
    const sql = (ordre: string | null) => `SELECT ${cols.join(", ")} FROM ${TABLE_MAITRE} WHERE ${c.where}${ordre ? ` ORDER BY ${ordre}` : ""} LIMIT ${n} OFFSET ${(p - 1) * n}`;
    // Sans filtre, ClickHouse estime 16 M de lignes avant même de lire et refuse (mesuré en prod le 14/11) :
    // on demande un critère plutôt que d'échouer ; les totaux de la France entière viennent du cube.
    if (!c.filtre) throw new FiltreInvalide(MESSAGE_SANS_FILTRE);
    let lignes: Ligne[];
    try {
      lignes = await this.requete<Ligne>(sql("rank DESC, siren"), c.params);
    } catch (e) {
      if (!(e instanceof Error && LIMITE_DEPASSEE.test(e.message))) throw e;
      try {
        lignes = await this.requete<Ligne>(sql(null), c.params);
      } catch (e2) {
        if (e2 instanceof Error && LIMITE_DEPASSEE.test(e2.message)) throw new FiltreInvalide(MESSAGE_TROP_LARGE);
        throw e2;
      }
    }
    return {
      colonnes: Object.keys(COLONNES_MAITRE),
      lignes: lignes.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, k.startsWith("a_") || k === "prospectable" ? Number(v) === 1 : v === "" ? null : v]))),
    };
  }

  async ficheMaitre(siren: string): Promise<Fiche | null> {
    if (!/^\d{9}$/.test(siren)) throw new FiltreInvalide("SIREN à 9 chiffres");
    const r = await this.requete<Record<string, unknown>>(
      `SELECT legal_name, trade_name, legal_form, forme_type, tranche_effectif, creation_date, administrative_status, naf_code, postal_code, department, city, has_email, has_phone, has_site, prospectable
       FROM ${TABLE_MAITRE} WHERE siren = {s:String} LIMIT 1`,
      { s: { type: "String", valeur: siren } },
    );
    const l = r[0];
    if (!l) return null;
    const v = (x: unknown) => (x === "" || x === null || x === undefined ? null : (x as string));
    return {
      identite: { siren, nom: v(l.legal_name), enseigne: v(l.trade_name), forme_juridique: formeJuridique(l.legal_form), date_creation: v(l.creation_date), statut: l.administrative_status === "A" ? "actif" : "fermé" },
      activite: { naf: v(l.naf_code) },
      lieu: { commune: v(l.city), code_postal: v(l.postal_code), departement: v(l.department) },
      contact: { email_connu: Number(l.has_email) === 1, telephone_connu: Number(l.has_phone) === 1, site_connu: Number(l.has_site) === 1, prospectable: Number(l.prospectable) === 1 },
    } as Fiche;
  }

  async compter(filtre: unknown) {
    const { where, params } = compilerFiltre(filtre);
    const r = await this.requete<{ n: string }>(`SELECT count() AS n FROM ${TABLE} WHERE ${where}`, params);
    return Number(r[0]?.n ?? 0);
  }

  async fiche(siren: string) {
    if (!/^\d{9}$/.test(siren)) throw new FiltreInvalide("SIREN à 9 chiffres");
    const cols = Object.entries(FICHE).flatMap(([t, m]) => Object.entries(m).map(([k, c]) => `${c} AS ${t}__${k}`));
    const s = { s: { type: "String", valeur: siren } as SqlParam };
    const [r, t] = await Promise.all([
      this.requete<Record<string, unknown>>(`SELECT ${cols.join(", ")} FROM ${TABLE} WHERE siren = {s:String} AND is_deleted = 0 LIMIT 1`, s),
      // Pile logicielle : une vue à part, son absence ne doit pas casser la fiche.
      this.requete<{ tools_fort: string[]; tools_cite: string[]; families_fort: string[] }>(`SELECT tools_fort, tools_cite, families_fort FROM ${TABLE_LOGICIELS} WHERE siren = {s:String} LIMIT 1`, s).catch(() => []),
    ]);
    if (!r[0]) return null;
    const fiche = regrouper(r[0]);
    const pile = t[0];
    if (pile && (pile.tools_fort?.length || pile.tools_cite?.length)) {
      fiche.logiciels = { utilises: pile.tools_fort ?? [], types: pile.families_fort ?? [], cites: pile.tools_cite ?? [] };
    }
    return fiche;
  }

  async points(filtre: unknown, departement: string, limite = 400) {
    if (!/^(\d{2,3}|2A|2B)$/.test(departement)) throw new FiltreInvalide("département invalide");
    const { where, params } = compilerFiltre(filtre);
    params.dep = { type: "String", valeur: departement };
    const sql = `SELECT siren, legal_name AS nom, city AS commune, latitude AS lat, longitude AS lon, email != '' AS email, primary_domain != '' AS site
      FROM ${TABLE} WHERE ${where} AND department = {dep:String} AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY priority_score_v2 DESC NULLS LAST, siren LIMIT ${Math.min(1000, Math.max(1, Math.trunc(limite)))}`;
    const r = await this.requete<Record<string, unknown>>(sql, params);
    return r.map((x) => ({ siren: String(x.siren), nom: String(x.nom), commune: String(x.commune), lat: Number(x.lat), lon: Number(x.lon), email: Number(x.email) === 1, site: Number(x.site) === 1 }));
  }

  async verifier(sirens: readonly string[]): Promise<Verification[]> {
    const liste = [...new Set(sirens)];
    if (!liste.length) return [];
    const p = { s: { type: "Array(String)", valeur: liste } as SqlParam };
    const fiches = await this.requete<Record<string, unknown>>(
      `SELECT siren, legal_name AS nom, city AS commune, department AS departement, naf_code AS naf, primary_domain AS site,
        ${ENVOYABLE_EMAIL} AS email_envoyable, ${ENVOYABLE_TELEPHONE} AS telephone_envoyable, size_band, deliverable FROM ${TABLE} WHERE siren IN {s:Array(String)}`,
      p,
    );
    const vues = new Set(fiches.map((f) => String(f.siren)));
    const reste = liste.filter((x) => !vues.has(x));
    // Le reste dans la base complète (index bloom sur le SIREN : quelques blocs lus, mesuré le 16/11).
    const maitre = reste.length
      ? await this.requete<Record<string, unknown>>(
          `SELECT siren, legal_name AS nom, city AS commune, department AS departement, naf_code AS naf, administrative_status AS statut,
            has_site, email_envoyable = 1 AND prospectable = 1 AS email_envoyable, telephone_envoyable = 1 AND prospectable = 1 AS telephone_envoyable
            FROM ${TABLE_MAITRE} WHERE siren IN {s:Array(String)}`,
          { s: { type: "Array(String)", valeur: reste } },
        )
      : [];
    // Pile illisible (droits, vue absente) : « inconnu » plutôt qu'une liste vide qui ferait croire « aucun outil ».
    const outils = await this.requete<{ siren: string; tools_fort: string[] }>(`SELECT siren, tools_fort FROM ${TABLE_LOGICIELS} WHERE siren IN {s:Array(String)}`, p).catch((e: unknown) => {
      console.error("[atlas] pile logicielle illisible :", e instanceof Error ? e.message.slice(0, 160) : e);
      return null;
    });
    const logiciels = new Map((outils ?? []).map((o) => [String(o.siren), o.tools_fort ?? []]));
    const pile = (siren: string) => (outils === null ? null : (logiciels.get(siren) ?? []));
    const v = (x: unknown) => (x === "" || x === null || x === undefined ? null : String(x));
    const parSiren = new Map<string, Verification>();
    for (const f of fiches) {
      const site = v(f.site);
      parSiren.set(String(f.siren), {
        siren: String(f.siren), trouvee: true, nom: v(f.nom), active: true, commune: v(f.commune), departement: v(f.departement), naf: v(f.naf),
        site, a_site: !!site, email_envoyable: Number(f.email_envoyable) === 1, telephone_utilisable: Number(f.telephone_envoyable) === 1, contactable: Number(f.deliverable) === 1,
        logiciels: pile(String(f.siren)),
        ...(site && f.size_band === "grande" ? { site_incertain: true } : {}),
      });
    }
    for (const m of maitre) {
      if (parSiren.has(String(m.siren))) continue;
      parSiren.set(String(m.siren), {
        siren: String(m.siren), trouvee: true, nom: v(m.nom), active: m.statut === "A", commune: v(m.commune), departement: v(m.departement), naf: v(m.naf),
        site: null, a_site: Number(m.has_site) === 1, email_envoyable: Number(m.email_envoyable) === 1, telephone_utilisable: Number(m.telephone_envoyable) === 1, contactable: false,
        logiciels: pile(String(m.siren)),
      });
    }
    return liste.map(
      (x) => parSiren.get(x) ?? { siren: x, trouvee: false, nom: null, active: null, commune: null, departement: null, naf: null, site: null, a_site: null, email_envoyable: null, telephone_utilisable: null, contactable: false, logiciels: [] },
    );
  }

  async sirensEnvoyables(filtre: unknown, scoring: unknown, plafond: number) {
    // Les exclues ne sortent jamais, même si le segment les montre à l'écran.
    const f = FiltreSchema.parse(filtre ?? {});
    const { where, params, score } = compilerFiltre({ ...f, inclure_bloques: false }, scoring ?? undefined);
    const envoyable = `${where} AND ${ENVOYABLE_EMAIL} AND email != ''`;
    const [l, t] = await Promise.all([
      this.requete<{ siren: string; version: string }>(
        `SELECT siren, toString(projection_version) AS version FROM ${TABLE} WHERE ${envoyable}
         ORDER BY ${score ?? "priority_score_v2"} DESC NULLS LAST, siren LIMIT ${Math.trunc(plafond)}`,
        params,
      ),
      this.requete<{ n: string }>(`SELECT count() AS n FROM ${TABLE} WHERE ${envoyable}`, params),
    ]);
    const sirens = [...new Set(l.map((x) => String(x.siren)))];
    return { sirens, total: Math.max(sirens.length, Number(t[0]?.n ?? 0)), version: l[0]?.version ?? "" };
  }

  async extraire(sirens: readonly string[]): Promise<LigneExtraite[]> {
    if (!sirens.length) return [];
    const r = await this.requete<Record<string, unknown>>(
      `SELECT siren, email, primary_domain AS domaine, legal_name AS raison_sociale, director_name AS dirigeant,
        director_role AS role_dirigeant, activity_label AS activite, naf_code AS naf, postal_code AS code_postal, city AS commune,
        department AS departement, if(${ENVOYABLE_TELEPHONE}, phone, '') AS telephone
       FROM ${TABLE} WHERE siren IN {s:Array(String)} AND is_deleted = 0 AND empty(blocking_reasons) AND ${ENVOYABLE_EMAIL} AND email != ''`,
      { s: { type: "Array(String)", valeur: [...sirens] } },
    );
    const v = (x: unknown) => (x === "" || x === null || x === undefined ? null : String(x));
    return r.map((l) => ({
      siren: String(l.siren), email: String(l.email), domaine: v(l.domaine), raison_sociale: String(l.raison_sociale ?? ""),
      dirigeant: v(l.dirigeant), role_dirigeant: v(l.role_dirigeant), activite: v(l.activite), naf: v(l.naf), code_postal: v(l.code_postal),
      commune: v(l.commune), departement: v(l.departement), telephone: v(l.telephone),
    }));
  }

  async pourCrm(siren: string): Promise<LigneCrm | null> {
    if (!/^\d{9}$/.test(siren)) throw new FiltreInvalide("SIREN à 9 chiffres");
    const r = await this.requete<Record<string, unknown>>(
      `SELECT siren, if(${ENVOYABLE_EMAIL}, email, '') AS email_utilisable, primary_domain AS domaine, legal_name AS raison_sociale, director_name AS dirigeant,
        director_role AS role_dirigeant, activity_label AS activite, naf_code AS naf, postal_code AS code_postal, city AS commune,
        department AS departement, if(${ENVOYABLE_TELEPHONE}, phone, '') AS telephone
       FROM ${TABLE} WHERE siren = {s:String} AND is_deleted = 0 AND empty(blocking_reasons) LIMIT 1`,
      { s: { type: "String", valeur: siren } },
    );
    const l = r[0];
    if (!l) return null;
    const v = (x: unknown) => (x === "" || x === null || x === undefined ? null : String(x));
    return {
      siren, email: v(l.email_utilisable), domaine: v(l.domaine), raison_sociale: String(l.raison_sociale ?? ""), dirigeant: v(l.dirigeant),
      role_dirigeant: v(l.role_dirigeant), activite: v(l.activite), naf: v(l.naf), code_postal: v(l.code_postal), commune: v(l.commune),
      departement: v(l.departement), telephone: v(l.telephone),
    };
  }

  async positions(sirens: readonly string[]): Promise<Arret[]> {
    const r = await this.requete<Record<string, unknown>>(
      `SELECT siren, legal_name AS nom, latitude AS lat, longitude AS lon FROM ${TABLE} WHERE siren IN {s:Array(String)} AND latitude IS NOT NULL AND longitude IS NOT NULL`,
      { s: { type: "Array(String)", valeur: [...sirens] } },
    );
    return r.map((l) => ({ siren: String(l.siren), nom: String(l.nom), lat: Number(l.lat), lon: Number(l.lon) }));
  }

  async compterParmi(filtre: unknown, sirens: readonly string[], axe?: "departement" | "naf") {
    if (!sirens.length) return { total: 0, lignes: [] };
    const c = compilerMaitre(filtre);
    let n = 0;
    const dans = parmiSirens(sirens, (type, valeur) => {
      const k = `cl${n++}`;
      c.params[k] = { type, valeur };
      return `{${k}:${type}}`;
    });
    const col = axe === "departement" ? "department" : axe === "naf" ? "naf_code" : "''";
    const r = await this.requete<{ cle: string; n: string }>(`SELECT ${col} AS cle, count() AS n FROM ${TABLE_MAITRE} WHERE ${c.where} AND ${dans} GROUP BY cle ORDER BY n DESC, cle LIMIT 200`, c.params);
    const lignes = r.map((l) => ({ cle: String(l.cle), n: Number(l.n) }));
    return { total: lignes.reduce((a, l) => a + l.n, 0), lignes: axe ? lignes : [] };
  }

  async chercher(r: Recherche): Promise<Trouvee[]> {
    const n = Math.min(20, Math.max(1, Math.trunc(r.limite)));
    const params: Record<string, SqlParam> = {};
    const where: string[] = [];
    let sirens: string[] | null = null;
    if ("domaine" in r) {
      const l = await this.requete<{ siren: string }>(
        `SELECT siren FROM ${TABLE} WHERE is_deleted = 0 AND empty(blocking_reasons) AND (primary_domain = {d:String} OR has(domains, {d:String})) ORDER BY primary_domain = {d:String} DESC, siren LIMIT ${n}`,
        { d: { type: "String", valeur: r.domaine } },
      );
      sirens = l.map((x) => String(x.siren));
      if (!sirens.length) return [];
    } else if ("siren" in r) sirens = [r.siren];
    if (sirens) {
      where.push("siren IN {s:Array(String)}");
      params.s = { type: "Array(String)", valeur: sirens };
    } else {
      where.push("hasAllTokens(name_terms, {m:Array(String)})");
      const { mots } = r as { mots: string[] };
      params.m = { type: "Array(String)", valeur: mots };
      // Trouvée par son nom avant celle qui ne porte le mot que dans son enseigne.
      params.p = { type: "String", valeur: mots.reduce((a, b) => (b.length > a.length ? b : a)) };
    }
    const parNom = params.p ? "positionCaseInsensitiveUTF8(legal_name, {p:String}) > 0 DESC, " : "";
    if (r.codePostal) {
      where.push("postal_code = {cp:String}");
      params.cp = { type: "String", valeur: r.codePostal };
    }
    const lignes = await this.requete<Record<string, unknown>>(
      `SELECT siren, legal_name, trade_name, city, postal_code, department, naf_code, tranche_effectif, creation_date, administrative_status, prospectable
       FROM ${TABLE_MAITRE} WHERE ${where.join(" AND ")} ORDER BY administrative_status = 'A' DESC, ${parNom}prospectable DESC, length(legal_name), siren LIMIT ${n}`,
      params,
    );
    const web = lignes.length
      ? await this.requete<Record<string, unknown>>(
          `SELECT siren, primary_domain AS site, activity_label AS activite FROM ${TABLE} WHERE siren IN {s:Array(String)} AND is_deleted = 0 AND empty(blocking_reasons)`,
          { s: { type: "Array(String)", valeur: lignes.map((l) => String(l.siren)) } },
        )
      : [];
    const par = new Map(web.map((w) => [String(w.siren), w]));
    const v = (x: unknown) => (x === "" || x === null || x === undefined ? null : String(x));
    return lignes.map((l) => ({
      siren: String(l.siren), nom: String(l.legal_name ?? ""), enseigne: v(l.trade_name), commune: v(l.city), code_postal: v(l.postal_code), departement: v(l.department),
      naf: v(l.naf_code), activite: v(par.get(String(l.siren))?.activite), effectif: v(l.tranche_effectif), date_creation: v(l.creation_date),
      active: l.administrative_status === "A", prospectable: Number(l.prospectable) === 1, site: v(par.get(String(l.siren))?.site),
    }));
  }

  async sql(requete: string) {
    const lignes = await this.requete<Ligne>(requete, {});
    return { colonnes: lignes[0] ? Object.keys(lignes[0]) : [], lignes };
  }

  async schema() {
    const r = await this.requete<{ table: string; colonne: string; type: string }>(
      `SELECT concat(database, '.', table) AS table, name AS colonne, type FROM system.columns
       WHERE database = 'odh' AND table IN {t:Array(String)} ORDER BY table, position`,
      { t: { type: "Array(String)", valeur: TABLES_SQL.map((x) => x.replace("odh.", "")) } },
    );
    return r;
  }

  async communes(filtre: unknown, departement: string, base: "marche" | "prospection"): Promise<CommunesBrutes> {
    if (!/^(\d{2}|2A|2B)$/.test(departement)) throw new FiltreInvalide("département invalide");
    if (base === "marche") {
      const c = compilerMaitre(filtre);
      c.params.dep = { type: "String", valeur: departement };
      const sql = `SELECT city AS nom, postal_code AS cp, count() AS entreprises, countIf(prospectable = 1) AS contactables,
        countIf(email_envoyable = 1 AND prospectable = 1) AS email_envoyable, countIf(telephone_envoyable = 1 AND prospectable = 1) AS telephone_envoyable
        FROM ${TABLE_MAITRE} WHERE ${c.where} AND department = {dep:String} GROUP BY nom, cp`;
      try {
        const r = await this.requete<Record<string, string>>(sql, c.params);
        return {
          base,
          repli: false,
          lignes: r.map((x) => ({
            insee: null, nom: x.nom, code_postal: x.cp || null,
            mesures: { entreprises: Number(x.entreprises), contactables: Number(x.contactables), email_envoyable: Number(x.email_envoyable), telephone_envoyable: Number(x.telephone_envoyable) },
          })),
        };
      } catch (e) {
        // Marché sans activité (département seul) : au-delà des 15 M lignes du compte, repli sur les fiches prospectables.
        if (!(e instanceof Error && LIMITE_DEPASSEE.test(e.message))) throw e;
        return { ...(await this.communes(filtre, departement, "prospection")), base: "marche", repli: true };
      }
    }
    const { where, params } = compilerFiltre(filtre);
    params.dep = { type: "String", valeur: departement };
    const sql = `SELECT commune_insee AS insee, any(city) AS nom, count() AS entreprises, countIf(${ENVOYABLE_EMAIL}) AS email_envoyable,
      countIf(${ENVOYABLE_TELEPHONE}) AS telephone_envoyable, countIf(primary_domain = '') AS sans_site, countIf(email != '') AS avec_email
      FROM ${TABLE} WHERE ${where} AND department = {dep:String} GROUP BY insee`;
    const r = await this.requete<Record<string, string>>(sql, params);
    return {
      base,
      repli: false,
      lignes: r.map((x) => ({
        insee: x.insee || null, nom: x.nom, code_postal: null,
        mesures: {
          entreprises: Number(x.entreprises), contactables: Number(x.entreprises), email_envoyable: Number(x.email_envoyable),
          telephone_envoyable: Number(x.telephone_envoyable), sans_site: Number(x.sans_site), avec_email: Number(x.avec_email),
        },
      })),
    };
  }

  async apercu(filtre: unknown, o: OptionsApercu) {
    const { where, params, score } = compilerFiltre(filtre, o.scoring);
    const { sql: select, champs, jointures } = colonnesSql(o.colonnes);
    const parPage = Math.min(o.plafond ?? 100, Math.max(1, Math.trunc(o.parPage)));
    const page = Math.max(1, Math.trunc(o.page));
    const sens = o.sens === "asc" ? "ASC" : "DESC";
    const tri = score ? null : champTri(o.tri);
    const ordre = score ? `score ${sens}` : `${tri!.sql} ${sens} NULLS LAST`;
    const sql = `SELECT ${select}${score ? `, ${score} AS score` : ""} FROM ${TABLE} ${jointures} WHERE ${where}${o.livrablesSeuls ? " AND deliverable = 1" : ""} ORDER BY ${ordre}, siren LIMIT ${parPage} OFFSET ${(page - 1) * parPage}`;
    const brut = await this.requete<Ligne>(sql, params);
    const lignes = brut.map((l) => ({ ...normaliser(l, champs), ...(score ? { score: Number(l.score) } : {}) }));
    return { colonnes: [...champs.map((c) => c.id), ...(score ? ["score"] : [])], page, parPage, tri: score ? "score" : tri!.id, lignes };
  }

  async repartition(filtre: unknown, champ: string, limite = 120) {
    const { where, params } = compilerFiltre(filtre);
    const c = champRepartition(champ);
    const n = Math.min(200, Math.max(1, Math.trunc(limite)));
    const sql = c.ensemble
      ? `SELECT arrayJoin(${c.sql}) AS cle, count() AS nombre FROM ${c.ensemble.table} WHERE siren IN (SELECT siren FROM ${TABLE} WHERE ${where}) GROUP BY cle ORDER BY nombre DESC LIMIT ${n}`
      : c.tableau
        ? `SELECT arrayJoin(${c.sql}) AS cle, count() AS nombre FROM ${TABLE} WHERE ${where} GROUP BY cle ORDER BY nombre DESC LIMIT ${n}`
        : `SELECT ${c.sql} AS cle, count() AS nombre FROM ${TABLE} WHERE ${where} AND ${c.sql} != '' GROUP BY cle ORDER BY nombre DESC LIMIT ${n}`;
    const r = await this.requete<{ cle: string; nombre: string }>(sql, params);
    return r.map((x) => ({ cle: x.cle, nombre: Number(x.nombre) }));
  }
}

/** Colonnes UInt8 de la fiche : 0/1 rendus en oui/non. */
const OUI_NON = new Set(["dirigeant__email_verifie", "contact__delivrable", "contact__email_envoyable", "contact__telephone_envoyable", "web__obsolete", "web__https", "web__responsive", "web__ecommerce", "signaux__rge", "signaux__qualiopi", "signaux__bio", "signaux__ess"]);

/** Forme juridique lisible (même dictionnaire que l'écran et l'export, src/atlas/libelles.ts). */
export function formeJuridique(code: unknown): string | null {
  if (code === null || code === undefined || code === "") return null;
  return libelleValeur("forme_juridique", String(code));
}

/** Remet les colonnes `theme__cle` en { theme: { cle: valeur } } : vides en null, 0/1 en oui/non, forme juridique en libellé. */
/**
 * Les cinq derniers signaux d'ODH (attributes_json.signals.events) en lignes lisibles :
 * « 14/09/2026 · Changement de dirigeant », avec « avant → après » quand ODH les donne.
 */
export function evenementsLisibles(brut: unknown): string[] | null {
  if (typeof brut !== "string" || !brut.trim()) return null;
  let l: unknown;
  try {
    l = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!Array.isArray(l)) return null;
  const lignes = l
    .filter((e): e is { date?: string; type?: string; before?: string; after?: string } => !!e && typeof e === "object")
    .map((e) => {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? "") ? e.date!.split("-").reverse().join("/") : "";
      const avant = (e.before ?? "").trim();
      const apres = (e.after ?? "").trim();
      // « avant → après » seulement quand ODH donne les deux (un rachat n'a que « après » = le type d'en face).
      const detail = avant && apres ? ` (${avant} → ${apres})` : "";
      return [date, `${libelleValeur("signal", e.type ?? "")}${detail}`].filter(Boolean).join(" · ");
    });
  return lignes.length ? lignes : null;
}

function regrouper(l: Record<string, unknown>): Fiche {
  const out: Fiche = {};
  for (const [k, v] of Object.entries(l)) {
    const [t, c] = k.split("__");
    out[t] ??= {};
    let val: string | number | boolean | null | string[] = v === "" || v === undefined ? null : (v as string | number | null | string[]);
    if (OUI_NON.has(k) && val !== null) val = Number(val) === 1;
    if (k === "identite__forme_juridique") val = formeJuridique(val);
    if (k === "evolutions__recents") val = evenementsLisibles(val);
    if (Array.isArray(val) && val.length === 0) val = null;
    out[t][c] = val;
  }
  return out;
}

/** ClickHouse rend les entiers 64 bits en texte et les booléens en 0/1 : on remet les types du catalogue. */
function normaliser(l: Ligne, champs: Champ[]): Ligne {
  const out: Ligne = {};
  for (const c of champs) {
    const v = l[c.id];
    if (v === null || v === undefined || v === "") out[c.id] = c.type === "texte" || c.type === "liste" ? (v ?? null) : null;
    else if (c.type === "nombre") out[c.id] = Number(v);
    else if (c.type === "oui_non") out[c.id] = Number(v) === 1;
    else out[c.id] = v;
  }
  return out;
}

/** Évalue une condition sur une ligne simulée : même sémantique que le SQL compilé. */
function vraie(c: Condition, l: Ligne): boolean {
  const champ = CHAMP.get(c.champ)!;
  const x = l[champ.id];
  const v = c.valeur;
  if (champ.espace) return (clientsCourants() ?? []).includes(String(l.siren)) === v;
  if (c.op === "renseigne") return (x !== null && x !== "" && x !== undefined) === v;
  if (x === null || x === undefined) return false;
  switch (c.op) {
    case "egal": return x === v;
    case "contient": return String(x).toLowerCase().includes(String(v).toLowerCase());
    case "dans": return (Array.isArray(v) ? v.map(String) : [String(v)]).includes(String(x));
    case "hors": return !(Array.isArray(v) ? v.map(String) : [String(v)]).includes(String(x));
    case "min": return Number(x) >= Number(v);
    case "max": return Number(x) <= Number(v);
    case "entre": return Array.isArray(v) && Number(x) >= Number(v[0]) && Number(x) <= Number(v[1]);
    case "apres": return String(x) >= String(v);
    case "avant": return String(x) < String(v);
    case "est": return x === v;
  }
  return false;
}

/** Source simulée : mêmes contrats, données inventées et stables. */
export class SourceSimulee implements SourceMarche {
  readonly simulee = true;
  readonly lignes: Ligne[];
  constructor(taille = 5000) {
    let a = 42;
    const r = () => (a = (a * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(l: readonly T[]) => l[Math.floor(r() * l.length)];
    this.lignes = Array.from({ length: taille }, (_, i) => {
      const naf = pick(["4322A", "4321A", "4752A", "5610A", "8623Z", "6920Z", "0149Z"]);
      const site = r() < 0.4 ? `site-${i}.demo` : "";
      return {
        siren: String(900000000 + i), nom: `Entreprise simulée ${i}`, forme_juridique: pick(["SARL", "SAS", "EI"]),
        date_creation: `${2000 + Math.floor(r() * 26)}-0${1 + Math.floor(r() * 9)}-15`, dirigeant: "",
        naf, naf_division: naf.slice(0, 2), secteur: pick(["BTP", "COMMERCE", "RESTAURATION", "SANTÉ", "AGRICULTURE"]),
        activite: "", departement: pick(["69", "38", "75", "13", "33", "44", "59", "31", "35", "74"]),
        code_postal: "69001", commune: "Commune simulée", commune_insee: "69381",
        taille: pick(["micro", "micro", "petite", "moyenne", "grande"]), effectif: "",
        chiffre_affaires: r() < 0.7 ? Math.round(50_000 + r() * 5_000_000) : null, resultat_net: null,
        tendance_ca: pick(["stable", "growth", "decline", ""]), site, niveau_web: site ? pick(["moderne", "correct", "vieillissant", "obsolete"]) : "",
        cms: site ? pick(["wordpress", "wix", ""]) : "", ecommerce: r() < 0.1, https: site !== "" && r() < 0.8,
        email: r() < 0.6 ? `contact@entreprise-${i}.demo` : "", email_verification: pick(["existe", "inconnu", "n_existe_pas", ""]), email_preuve: pick(["mx_present", "web_disparu", "aucune_sonde"]),
        messagerie: pick(["gmail", "ovh", "microsoft", ""]), telephone: r() < 0.7 ? "0400000000" : "",
        rge: r() < 0.08, qualiopi: r() < 0.03, marches_publics: r() < 0.05 ? 1 + Math.floor(r() * 5) : 0,
        permis_3_ans: r() < 0.1 ? 1 : 0, score_odh: Math.round(r() * 100), grade: pick(["or", "a_requalifier"]),
      };
    });
    // Simulation de la règle d'ODH : email connu, boîte non inexistante, toujours publié.
    for (const l of this.lignes) {
      l.email_envoyable = l.email !== "" && l.email_verification !== "n_existe_pas" && l.email_preuve !== "web_disparu";
      l.motif_email = l.email === "" || l.email_envoyable ? "" : l.email_verification === "n_existe_pas" ? "boite_inexistante" : "email_disparu_du_site";
      l.telephone_envoyable = l.telephone !== "";
    }
  }
  private filtrer(filtre: unknown): Ligne[] {
    compilerFiltre(filtre); // même validation, mêmes erreurs qu'en prod
    const f = FiltreSchema.parse(filtre ?? {});
    return this.lignes.filter((l) => f.conditions.every((c) => vraie(c, l)));
  }
  async compter(filtre: unknown) {
    return this.filtrer(filtre).length;
  }
  async activites(radicaux: readonly string[], codesLibelle: readonly string[], limite: number): Promise<CodeActivite[]> {
    const n = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const parNom = new Map<string, number>();
    for (const l of this.lignes) {
      const t = n(`${l.nom} ${l.activite}`);
      if (radicaux.every((m) => new RegExp(motifMot(m)).test(t))) parNom.set(String(l.naf), (parNom.get(String(l.naf)) ?? 0) + 1);
    }
    const libelles = new Set(codesLibelle);
    return [...new Set([...codesLibelle, ...parNom.keys()])]
      .map((c) => {
        const ls = this.lignes.filter((l) => l.naf === c);
        return {
          naf: c,
          libelle: NAF_LIBELLES[c] ?? c,
          signaux: [...(libelles.has(c) ? (["libelle"] as const) : []), ...(parNom.has(c) ? (["usage"] as const) : [])],
          par_nom: parNom.get(c) ?? 0,
          entreprises_actives: ls.length,
          contactables: ls.length,
          email_envoyable: ls.filter((l) => l.email_envoyable).length,
        };
      })
      .sort((a, b) => Number(b.signaux.includes("libelle")) - Number(a.signaux.includes("libelle")) || b.par_nom - a.par_nom || b.entreprises_actives - a.entreprises_actives)
      .slice(0, limite);
  }

  /** Conditions que la base maître sait appliquer (les autres sont rendues comme ignorées). */
  private traduisibles(filtre: unknown) {
    const c = compilerMaitre(filtre);
    const ign = new Set(c.ignorees.map((x) => JSON.stringify(x)));
    return { c, conditions: FiltreSchema.parse(filtre ?? {}).conditions.filter((x) => !ign.has(JSON.stringify(x))) };
  }
  async compterMaitre(filtre: unknown) {
    const { c, conditions } = this.traduisibles(filtre);
    return c.filtre ? this.filtrer({ conditions }).length : null;
  }
  async listerMaitre(filtre: unknown, page: number, parPage: number) {
    const { c, conditions } = this.traduisibles(filtre);
    if (!c.filtre) throw new FiltreInvalide(MESSAGE_SANS_FILTRE);
    const ls = this.filtrer({ conditions });
    const lignes = ls.slice((page - 1) * parPage, page * parPage).map((l) => ({
      siren: l.siren, nom: l.nom, enseigne: null, commune: l.commune, departement: l.departement, naf: l.naf, forme: "societe", effectif: null,
      date_creation: l.date_creation, a_email: !!l.email, a_telephone: !!l.telephone, a_site: !!l.site, prospectable: true,
    }));
    return { colonnes: Object.keys(COLONNES_MAITRE), lignes };
  }
  async ficheMaitre(siren: string) {
    return this.fiche(siren);
  }

  /** Cube simulé : les lignes simulées, sur les axes NAF, division et département seulement. */
  async marche(entree: unknown): Promise<ResultatCube> {
    const { entree: e } = compilerCube(entree); // même validation qu'en prod
    const garde = (l: Ligne) =>
      (!e.naf || e.naf.map((c) => c.replace(".", "").toUpperCase()).includes(String(l.naf))) &&
      (!e.divisions || e.divisions.includes(String(l.naf_division))) &&
      (!e.departements || e.departements.includes(String(l.departement)));
    const compte = (ls: Ligne[]) =>
      mesures({
        entreprises: ls.length, email_connu: ls.filter((l) => l.email).length, telephone_connu: ls.filter((l) => l.telephone).length,
        site_connu: ls.filter((l) => l.site).length, un_canal_connu: ls.filter((l) => l.email || l.telephone).length, prospectables: ls.length,
        email_envoyable: ls.filter((l) => l.email_envoyable).length, telephone_envoyable: ls.filter((l) => l.telephone).length,
      });
    const ls = this.lignes.filter(garde);
    const axe = e.axe ?? null;
    const col = axe === "naf" ? "naf" : axe === "departement" ? "departement" : null;
    const groupes = new Map<string, Ligne[]>();
    if (col) for (const l of ls) groupes.set(String(l[col]), [...(groupes.get(String(l[col])) ?? []), l]);
    const lignes = [...groupes].map(([cle, g]) => ({ cle, libelle: libelleCube(axe!, cle), ...compte(g) })).sort((a, b) => b.entreprises - a.entreprises).slice(0, e.limite);
    return { total: compte(ls), axe, lignes, provenance: null };
  }
  async fiche(siren: string) {
    if (!/^\d{9}$/.test(siren)) throw new FiltreInvalide("SIREN à 9 chiffres");
    const l = this.lignes.find((x) => x.siren === siren);
    if (!l) return null;
    return { identite: { siren: l.siren, nom: l.nom, forme_juridique: l.forme_juridique, date_creation: l.date_creation }, lieu: { commune: l.commune, departement: l.departement }, contact: { email: l.email || null, telephone: l.telephone || null, email_envoyable: l.email_envoyable ? 1 : 0 }, web: { site: l.site || null }, finances: { chiffre_affaires: l.chiffre_affaires }, qualite: { score_odh: l.score_odh } } as Fiche;
  }
  async points(filtre: unknown, departement: string, limite = 400) {
    if (!/^(\d{2,3}|2A|2B)$/.test(departement)) throw new FiltreInvalide("département invalide");
    return this.filtrer(filtre)
      .filter((l) => l.departement === departement)
      .slice(0, limite)
      .map((l, i) => ({ siren: String(l.siren), nom: String(l.nom), commune: String(l.commune), lat: 45 + (i % 20) / 40, lon: 5 + Math.floor(i / 20) / 40, email: Boolean(l.email), site: Boolean(l.site) }));
  }
  async verifier(sirens: readonly string[]): Promise<Verification[]> {
    return [...new Set(sirens)].map((x) => {
      const l = this.lignes.find((y) => y.siren === x);
      return l
        ? { siren: x, trouvee: true, nom: String(l.nom), active: true, commune: String(l.commune), departement: String(l.departement), naf: String(l.naf), site: l.site ? String(l.site) : null, a_site: !!l.site, email_envoyable: !!l.email_envoyable, telephone_utilisable: !!l.telephone_envoyable, contactable: true, logiciels: [] }
        : { siren: x, trouvee: false, nom: null, active: null, commune: null, departement: null, naf: null, site: null, a_site: null, email_envoyable: null, telephone_utilisable: null, contactable: false, logiciels: [] };
    });
  }
  async sirensEnvoyables(filtre: unknown, scoring: unknown, plafond: number) {
    const f = FiltreSchema.parse(filtre ?? {});
    const l = this.filtrer({ ...f, inclure_bloques: false }).filter((x) => x.email_envoyable);
    if (scoring) ScoringSchema.parse(scoring);
    l.sort((a, b) => Number(b.score_odh) - Number(a.score_odh) || (String(a.siren) < String(b.siren) ? -1 : 1));
    return { sirens: l.slice(0, plafond).map((x) => String(x.siren)), total: l.length, version: "simulee" };
  }
  async extraire(sirens: readonly string[]): Promise<LigneExtraite[]> {
    const voulus = new Set(sirens);
    return this.lignes
      .filter((l) => voulus.has(String(l.siren)) && l.email_envoyable)
      .map((l) => ({
        siren: String(l.siren), email: String(l.email), domaine: l.site ? String(l.site) : null, raison_sociale: String(l.nom), dirigeant: null, role_dirigeant: null,
        activite: null, naf: String(l.naf), code_postal: String(l.code_postal), commune: String(l.commune), departement: String(l.departement), telephone: l.telephone ? String(l.telephone) : null,
      }));
  }

  async pourCrm(siren: string): Promise<LigneCrm | null> {
    const l = this.lignes.find((x) => String(x.siren) === siren);
    if (!l) return null;
    return {
      siren, email: l.email_envoyable ? String(l.email) : null, domaine: l.site ? String(l.site) : null, raison_sociale: String(l.nom), dirigeant: null, role_dirigeant: null,
      activite: null, naf: String(l.naf), code_postal: String(l.code_postal), commune: String(l.commune), departement: String(l.departement), telephone: l.telephone ? String(l.telephone) : null,
    };
  }
  async positions(sirens: readonly string[]): Promise<Arret[]> {
    return this.lignes.filter((l) => sirens.includes(String(l.siren))).map((l, i) => ({ siren: String(l.siren), nom: String(l.nom), lat: 45 + i / 50, lon: 5 + (i % 3) / 50 }));
  }
  async compterParmi(filtre: unknown, sirens: readonly string[], axe?: "departement" | "naf") {
    const { conditions } = this.traduisibles(filtre);
    const ls = this.filtrer({ conditions }).filter((l) => sirens.includes(String(l.siren)));
    const par = new Map<string, number>();
    if (axe) for (const l of ls) par.set(String(l[axe]), (par.get(String(l[axe])) ?? 0) + 1);
    return { total: ls.length, lignes: [...par].map(([cle, n]) => ({ cle, n })).sort((a, b) => b.n - a.n) };
  }
  async chercher(r: Recherche): Promise<Trouvee[]> {
    return this.lignes
      .filter((l) => ("siren" in r ? String(l.siren) === r.siren : "domaine" in r ? l.site === r.domaine : r.mots.every((m) => String(l.nom).toLowerCase().includes(m))) && (!r.codePostal || String(l.code_postal) === r.codePostal))
      .slice(0, r.limite)
      .map((l) => ({ siren: String(l.siren), nom: String(l.nom), enseigne: null, commune: String(l.commune), code_postal: String(l.code_postal), departement: String(l.departement), naf: String(l.naf), activite: null, effectif: null, date_creation: null, active: true, prospectable: true, site: l.site ? String(l.site) : null }));
  }
  async sql(_requete: string) {
    return { colonnes: ["siren", "nom"], lignes: this.lignes.slice(0, 3).map((l) => ({ siren: l.siren, nom: l.nom })) };
  }
  async schema() {
    return [{ table: "odh.company_prospection_current", colonne: "siren", type: "String" }];
  }
  async communes(filtre: unknown, departement: string, base: "marche" | "prospection"): Promise<CommunesBrutes> {
    if (!/^(\d{2}|2A|2B)$/.test(departement)) throw new FiltreInvalide("département invalide");
    const m = new Map<string, CommunesBrutes["lignes"][number]>();
    for (const l of this.filtrer(filtre).filter((x) => x.departement === departement)) {
      const k = String(l.commune_insee);
      const c = m.get(k) ?? { insee: k, nom: String(l.commune), code_postal: String(l.code_postal), mesures: { entreprises: 0, contactables: 0, email_envoyable: 0, telephone_envoyable: 0, sans_site: 0, avec_email: 0 } };
      c.mesures.entreprises++;
      c.mesures.contactables++;
      if (l.email_envoyable) c.mesures.email_envoyable++;
      if (l.telephone_envoyable) c.mesures.telephone_envoyable++;
      if (!l.site) c.mesures.sans_site++;
      if (l.email) c.mesures.avec_email++;
      m.set(k, c);
    }
    return { base, repli: false, lignes: [...m.values()] };
  }
  async apercu(filtre: unknown, o: OptionsApercu) {
    compilerFiltre(filtre, o.scoring); // même validation qu'en prod
    const { champs } = colonnesSql(o.colonnes);
    const scoring = o.scoring === undefined ? null : ScoringSchema.parse(o.scoring);
    const tri = scoring ? null : champTri(o.tri);
    const parPage = Math.min(o.plafond ?? 100, Math.max(1, Math.trunc(o.parPage)));
    const page = Math.max(1, Math.trunc(o.page));
    const s = o.sens === "asc" ? 1 : -1;
    const total = scoring ? scoring.criteres.reduce((a, c) => a + c.poids, 0) : 1;
    const avecScore = this.filtrer(filtre).map((l) =>
      scoring ? { ...l, score: Math.round((scoring.criteres.reduce((a, c) => a + (vraie(c, l) ? c.poids : 0), 0) * 100) / total) } : l,
    );
    const cle = scoring ? "score" : tri!.id;
    const triees = avecScore.sort((a, b) => {
      const x = a[cle], y = b[cle];
      if (x === null) return 1;
      if (y === null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * s;
    });
    const ids = [...champs.map((c) => c.id), ...(scoring ? ["score"] : [])];
    const lignes = triees.slice((page - 1) * parPage, page * parPage).map((l) => Object.fromEntries(ids.map((id) => [id, l[id] === "" ? null : l[id]])));
    return { colonnes: ids, page, parPage, tri: cle, lignes };
  }
  async repartition(filtre: unknown, champ: string, limite = 120) {
    const c = champRepartition(champ);
    const m = new Map<string, number>();
    for (const l of this.filtrer(filtre)) {
      const k = l[c.id];
      if (k !== null && k !== "") m.set(String(k), (m.get(String(k)) ?? 0) + 1);
    }
    return [...m].map(([cle, nombre]) => ({ cle, nombre })).sort((a, b) => b.nombre - a.nombre).slice(0, limite);
  }
}

let instance: SourceMarche | null = null;
export function sourceMarche(env: NodeJS.ProcessEnv = process.env): SourceMarche {
  if (instance) return instance;
  instance = env.CLICKHOUSE_PASSWORD
    ? new SourceClickHouse({
        url: env.CLICKHOUSE_URL || "http://100.96.29.49:28123/",
        user: env.CLICKHOUSE_USER || "prospection_ro",
        password: env.CLICKHOUSE_PASSWORD,
      })
    : new SourceSimulee();
  return instance;
}
