/**
 * Source des données marché d'Atlas. En prod : ClickHouse ODH en lecture seule (compte prospection_ro,
 * vue odh.company_prospection_current). Sans CLICKHOUSE_PASSWORD (dev, tests, avant la création du
 * compte) : source simulée déterministe, signalée par `simulee: true` dans chaque réponse.
 */
import { CHAMP, CHAMPS, type Champ } from "./champs";
import { motifMot, type CodeActivite } from "./activites";
import { compilerCube, libelleCube, mesures, TABLE_CUBE, type ResultatCube } from "./cube";
import { NAF_LIBELLES } from "./naf";
import { FiltreInvalide, FiltreSchema, ScoringSchema, colonnesSql, compilerFiltre, type Condition, type SqlParam } from "./filtres";

export type Ligne = Record<string, string | number | boolean | null>;
export type Apercu = { colonnes: string[]; page: number; parPage: number; tri: string; lignes: Ligne[] };
/** Options d'aperçu ; avec `scoring`, chaque ligne a une colonne `score` (0-100) et le tri se fait dessus. */
export type OptionsApercu = { colonnes: string[]; page: number; parPage: number; tri?: string; sens?: "asc" | "desc"; scoring?: unknown; /** lignes par page au plus (100 pour l'écran, l'export en demande plus) */ plafond?: number };

/** Fiche complète d'une entreprise : colonnes ODH renommées en français, regroupées par thème. */
export type Fiche = Record<string, Record<string, string | number | boolean | null | string[]>>;
export type Point = { siren: string; nom: string; commune: string; lat: number; lon: number; email: boolean; site: boolean };

/** Colonnes de la fiche : thème → (clé française → colonne ODH). Liste blanche, comme le catalogue. */
export const FICHE: Record<string, Record<string, string>> = {
  identite: { siren: "siren", nom: "legal_name", forme_juridique: "legal_form", categorie: "company_category", date_creation: "creation_date", capital: "share_capital", statut: "administrative_status", procedure: "procedure_status", date_procedure: "procedure_date" },
  activite: { naf: "naf_code", secteur: "activity_sector", activite: "activity_label", services: "activity_services", idcc: "idcc_label", opco: "opco_name" },
  lieu: { commune: "city", code_postal: "postal_code", departement: "department", commune_insee: "commune_insee", latitude: "latitude", longitude: "longitude" },
  dirigeant: { nom: "director_name", role: "director_role", email: "director_email", email_verifie: "director_email_verified" },
  contact: { email: "email", type_email: "email_type", verification: "email_verification", preuve: "email_verification_basis", email_envoyable: "email_envoyable", motif_email: "motif_email_non_envoyable", telephone_envoyable: "telephone_envoyable", messagerie: "mail_provider_group", telephone: "phone", delivrable: "deliverable" },
  web: { site: "primary_domain", domaines: "domains", niveau: "web_tier", obsolete: "website_obsolete", https: "has_https", responsive: "has_responsive", outil: "cms", ecommerce: "is_ecommerce", plateforme_ecommerce: "ecom_platform" },
  finances: { chiffre_affaires: "revenue", resultat_net: "net_income", ebe: "ebe", tresorerie_nette: "net_cash", annee: "financials_year", croissance_pct: "revenue_growth_pct", tendance: "revenue_trend", effectif: "headcount_value", taille: "size_band" },
  groupe: { maison_mere: "parent_name", filiales: "subsidiaries_count", tete_de_groupe: "group_root_name", taille_groupe: "group_size" },
  signaux: { rge: "label_rge", qualiopi: "label_qualiopi", bio: "label_bio", ess: "label_ess", marches_publics: "public_contracts_count", montant_marches: "public_contracts_amount", permis_3_ans: "pub_permits_3y_count", aides_minimis: "pub_minimis_count" },
  qualite: { score_odh: "priority_score_v2", grade: "lead_grade", confiance: "confidence_tier", blocages: "blocking_reasons" },
};

export interface SourceMarche {
  readonly simulee: boolean;
  fiche(siren: string): Promise<Fiche | null>;
  points(filtre: unknown, departement: string, limite?: number): Promise<Point[]>;
  compter(filtre: unknown): Promise<number>;
  apercu(filtre: unknown, o: OptionsApercu): Promise<Apercu>;
  repartition(filtre: unknown, champ: string, limite?: number): Promise<{ cle: string; nombre: number }[]>;
  /** Taille du marché entier, d'après le cube d'ODH (voir cube.ts). */
  marche(entree: unknown): Promise<ResultatCube>;
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
    // Texte comparé sans accents ni casse : « ÉLEVAGE » et « elevage » se rejoignent.
    const texte = "replaceRegexpAll(normalizeUTF8NFD(lowerUTF8(concat(legal_name, ' ', activity_label))), '\\\\p{Mn}', '')"; // le SQL reçoit '\\p{Mn}' : classe Unicode des accents
    const params: Record<string, SqlParam> = {};
    const conds = radicaux.map((m, i) => {
      params[`r${i}`] = { type: "String", valeur: m };
      params[`m${i}`] = { type: "String", valeur: motifMot(m) };
      // Sous-chaîne d'abord (rapide, mesuré 0,6 s sur 2 M de fiches), mot entier ensuite sur les seules lignes
      // retenues : l'expression régulière sur toutes les lignes dépassait les 10 s du compte (14/11).
      return `positionUTF8(t, {r${i}:String}) > 0 AND match(t, {m${i}:String})`;
    });
    const usage = await this.requete<{ naf: string; n: string }>(
      `WITH ${texte} AS t SELECT naf_code AS naf, count() AS n FROM ${TABLE} WHERE is_deleted = 0 AND naf_code != '' AND ${conds.join(" AND ")} GROUP BY naf ORDER BY n DESC, naf LIMIT ${Math.min(40, Math.max(1, limite))}`,
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

  async compter(filtre: unknown) {
    const { where, params } = compilerFiltre(filtre);
    const r = await this.requete<{ n: string }>(`SELECT count() AS n FROM ${TABLE} WHERE ${where}`, params);
    return Number(r[0]?.n ?? 0);
  }

  async fiche(siren: string) {
    if (!/^\d{9}$/.test(siren)) throw new FiltreInvalide("SIREN à 9 chiffres");
    const cols = Object.entries(FICHE).flatMap(([t, m]) => Object.entries(m).map(([k, c]) => `${c} AS ${t}__${k}`));
    const r = await this.requete<Record<string, unknown>>(`SELECT ${cols.join(", ")} FROM ${TABLE} WHERE siren = {s:String} AND is_deleted = 0 LIMIT 1`, { s: { type: "String", valeur: siren } });
    return r[0] ? regrouper(r[0]) : null;
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

  async apercu(filtre: unknown, o: OptionsApercu) {
    const { where, params, score } = compilerFiltre(filtre, o.scoring);
    const { sql: select, champs } = colonnesSql(o.colonnes);
    const parPage = Math.min(o.plafond ?? 100, Math.max(1, Math.trunc(o.parPage)));
    const page = Math.max(1, Math.trunc(o.page));
    const sens = o.sens === "asc" ? "ASC" : "DESC";
    const tri = score ? null : champTri(o.tri);
    const ordre = score ? `score ${sens}` : `${tri!.sql} ${sens} NULLS LAST`;
    const sql = `SELECT ${select}${score ? `, ${score} AS score` : ""} FROM ${TABLE} WHERE ${where} ORDER BY ${ordre}, siren LIMIT ${parPage} OFFSET ${(page - 1) * parPage}`;
    const brut = await this.requete<Ligne>(sql, params);
    const lignes = brut.map((l) => ({ ...normaliser(l, champs), ...(score ? { score: Number(l.score) } : {}) }));
    return { colonnes: [...champs.map((c) => c.id), ...(score ? ["score"] : [])], page, parPage, tri: score ? "score" : tri!.id, lignes };
  }

  async repartition(filtre: unknown, champ: string, limite = 120) {
    const { where, params } = compilerFiltre(filtre);
    const c = champRepartition(champ);
    const sql = `SELECT ${c.sql} AS cle, count() AS nombre FROM ${TABLE} WHERE ${where} AND ${c.sql} != '' GROUP BY cle ORDER BY nombre DESC LIMIT ${Math.min(200, Math.max(1, Math.trunc(limite)))}`;
    const r = await this.requete<{ cle: string; nombre: string }>(sql, params);
    return r.map((x) => ({ cle: x.cle, nombre: Number(x.nombre) }));
  }
}

/** Colonnes UInt8 de la fiche : 0/1 rendus en oui/non. */
const OUI_NON = new Set(["dirigeant__email_verifie", "contact__delivrable", "contact__email_envoyable", "contact__telephone_envoyable", "web__obsolete", "web__https", "web__responsive", "web__ecommerce", "signaux__rge", "signaux__qualiopi", "signaux__bio", "signaux__ess"]);

/** Catégories juridiques INSEE les plus courantes, en libellé court ; sinon le code reste lisible. */
const FORMES: Record<string, string> = {
  "1000": "EI", "5499": "SARL", "5498": "EURL", "5410": "SARL", "5710": "SAS", "5720": "SASU", "5599": "SA", "5505": "SA",
  "5202": "SNC", "5306": "SCS", "6540": "SCI", "6599": "Société civile", "6533": "GAEC", "6598": "EARL", "6597": "Société civile agricole",
  "6316": "CUMA", "9220": "Association", "9210": "Association", "5458": "SELARL", "5785": "SELAS", "6585": "Société civile de moyens",
};
export function formeJuridique(code: unknown): string | null {
  if (code === null || code === undefined || code === "") return null;
  const c = String(code);
  return FORMES[c] ?? `catégorie ${c}`;
}

/** Remet les colonnes `theme__cle` en { theme: { cle: valeur } } : vides en null, 0/1 en oui/non, forme juridique en libellé. */
function regrouper(l: Record<string, unknown>): Fiche {
  const out: Fiche = {};
  for (const [k, v] of Object.entries(l)) {
    const [t, c] = k.split("__");
    out[t] ??= {};
    let val: string | number | boolean | null | string[] = v === "" || v === undefined ? null : (v as string | number | null | string[]);
    if (OUI_NON.has(k) && val !== null) val = Number(val) === 1;
    if (k === "identite__forme_juridique") val = formeJuridique(val);
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
    return { identite: { siren: l.siren, nom: l.nom, forme_juridique: l.forme_juridique, date_creation: l.date_creation }, lieu: { commune: l.commune, departement: l.departement }, contact: { email: l.email || null, telephone: l.telephone || null }, web: { site: l.site || null }, finances: { chiffre_affaires: l.chiffre_affaires }, qualite: { score_odh: l.score_odh } } as Fiche;
  }
  async points(filtre: unknown, departement: string, limite = 400) {
    if (!/^(\d{2,3}|2A|2B)$/.test(departement)) throw new FiltreInvalide("département invalide");
    return this.filtrer(filtre)
      .filter((l) => l.departement === departement)
      .slice(0, limite)
      .map((l, i) => ({ siren: String(l.siren), nom: String(l.nom), commune: String(l.commune), lat: 45 + (i % 20) / 40, lon: 5 + Math.floor(i / 20) / 40, email: Boolean(l.email), site: Boolean(l.site) }));
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
