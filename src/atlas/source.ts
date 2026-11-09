/**
 * Source des données marché d'Atlas. En prod : ClickHouse ODH en lecture seule (compte prospection_ro,
 * vue odh.company_prospection_current). Sans CLICKHOUSE_PASSWORD (dev, tests, avant la création du
 * compte) : source simulée déterministe, signalée par `simulee: true` dans chaque réponse.
 */
import { CHAMP, CHAMPS, type Champ } from "./champs";
import { FiltreInvalide, FiltreSchema, colonnesSql, compilerFiltre, type Condition, type SqlParam } from "./filtres";

export type Ligne = Record<string, string | number | boolean | null>;
export type Apercu = { colonnes: string[]; page: number; parPage: number; tri: string; lignes: Ligne[] };

export interface SourceMarche {
  readonly simulee: boolean;
  compter(filtre: unknown): Promise<number>;
  apercu(filtre: unknown, o: { colonnes: string[]; page: number; parPage: number; tri?: string; sens?: "asc" | "desc" }): Promise<Apercu>;
  repartition(filtre: unknown, champ: string, limite?: number): Promise<{ cle: string; nombre: number }[]>;
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

export class SourceClickHouse implements SourceMarche {
  readonly simulee = false;
  constructor(
    private readonly cfg: { url: string; user: string; password: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async requete<T>(sql: string, params: Record<string, SqlParam>): Promise<T[]> {
    const u = new URL(this.cfg.url);
    // Bornes côté serveur, en plus du profil du compte : lecture seule, 10 s, résultat borné.
    u.searchParams.set("readonly", "1");
    u.searchParams.set("max_execution_time", "10");
    u.searchParams.set("max_result_rows", "10000");
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

  async compter(filtre: unknown) {
    const { where, params } = compilerFiltre(filtre);
    const r = await this.requete<{ n: string }>(`SELECT count() AS n FROM ${TABLE} WHERE ${where}`, params);
    return Number(r[0]?.n ?? 0);
  }

  async apercu(filtre: unknown, o: { colonnes: string[]; page: number; parPage: number; tri?: string; sens?: "asc" | "desc" }) {
    const { where, params } = compilerFiltre(filtre);
    const { sql: select, champs } = colonnesSql(o.colonnes);
    const tri = champTri(o.tri);
    const parPage = Math.min(100, Math.max(1, Math.trunc(o.parPage)));
    const page = Math.max(1, Math.trunc(o.page));
    const sens = o.sens === "asc" ? "ASC" : "DESC";
    const sql = `SELECT ${select} FROM ${TABLE} WHERE ${where} ORDER BY ${tri.sql} ${sens} NULLS LAST, siren LIMIT ${parPage} OFFSET ${(page - 1) * parPage}`;
    const brut = await this.requete<Ligne>(sql, params);
    const lignes = brut.map((l) => normaliser(l, champs));
    return { colonnes: champs.map((c) => c.id), page, parPage, tri: tri.id, lignes };
  }

  async repartition(filtre: unknown, champ: string, limite = 120) {
    const { where, params } = compilerFiltre(filtre);
    const c = champRepartition(champ);
    const sql = `SELECT ${c.sql} AS cle, count() AS nombre FROM ${TABLE} WHERE ${where} AND ${c.sql} != '' GROUP BY cle ORDER BY nombre DESC LIMIT ${Math.min(200, Math.max(1, Math.trunc(limite)))}`;
    const r = await this.requete<{ cle: string; nombre: string }>(sql, params);
    return r.map((x) => ({ cle: x.cle, nombre: Number(x.nombre) }));
  }
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
        email: r() < 0.6 ? `contact@entreprise-${i}.demo` : "", email_verification: pick(["existe", "inconnu", ""]),
        messagerie: pick(["gmail", "ovh", "microsoft", ""]), telephone: r() < 0.7 ? "0400000000" : "",
        rge: r() < 0.08, qualiopi: r() < 0.03, marches_publics: r() < 0.05 ? 1 + Math.floor(r() * 5) : 0,
        permis_3_ans: r() < 0.1 ? 1 : 0, score_odh: Math.round(r() * 100), grade: pick(["or", "a_requalifier"]),
      };
    });
  }
  private filtrer(filtre: unknown): Ligne[] {
    compilerFiltre(filtre); // même validation, mêmes erreurs qu'en prod
    const f = FiltreSchema.parse(filtre ?? {});
    return this.lignes.filter((l) => f.conditions.every((c) => vraie(c, l)));
  }
  async compter(filtre: unknown) {
    return this.filtrer(filtre).length;
  }
  async apercu(filtre: unknown, o: { colonnes: string[]; page: number; parPage: number; tri?: string; sens?: "asc" | "desc" }) {
    const { champs } = colonnesSql(o.colonnes);
    const tri = champTri(o.tri);
    const parPage = Math.min(100, Math.max(1, Math.trunc(o.parPage)));
    const page = Math.max(1, Math.trunc(o.page));
    const s = o.sens === "asc" ? 1 : -1;
    const triees = this.filtrer(filtre).sort((a, b) => {
      const x = a[tri.id], y = b[tri.id];
      if (x === null) return 1;
      if (y === null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * s;
    });
    const lignes = triees.slice((page - 1) * parPage, page * parPage).map((l) => Object.fromEntries(champs.map((c) => [c.id, l[c.id] === "" ? null : l[c.id]])));
    return { colonnes: champs.map((c) => c.id), page, parPage, tri: tri.id, lignes };
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
