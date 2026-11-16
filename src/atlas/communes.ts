/**
 * Communes d'un département pour la carte : contours officiels (API Géo de l'État, geo.api.gouv.fr,
 * Licence Ouverte), projetés et simplifiés une fois côté serveur, gardés en mémoire 24 h.
 * Paris, Lyon et Marseille sont découpées en arrondissements, comme les adresses d'ODH. Les intercommunalités
 * (métropoles, communautés de communes ou d'agglomération) sont redessinées par union de leurs communes.
 */
import { cheminSvg, cleCommune, projeter } from "./projection";
import type { CommunesBrutes } from "./source";

export type CommuneGeo = {
  code: string;
  nom: string;
  /** Clé de rapprochement par le nom (base maître, qui n'a pas le code INSEE). */
  cle: string;
  /** Codes postaux, pour départager deux communes de même nom. */
  cp: string[];
  /** Intercommunalité (code SIREN de l'EPCI), null hors EPCI. */
  epci: string | null;
  d: string;
  /** Boîte englobante dans les coordonnées de la carte. */
  x: number;
  y: number;
  w: number;
  h: number;
};

const API = "https://geo.api.gouv.fr/communes";
const DUREE = 24 * 3600 * 1000;
/** Communes remplacées par leurs arrondissements municipaux. */
const DECOUPEES = new Set(["75056", "69123", "13055"]);

type Feature = { properties: { code: string; nom: string; codesPostaux?: string[]; codeEpci?: string }; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } | null };

/** Intercommunalité dessinée : contour reconstitué par union des communes du département qui en sont. */
export type EpciGeo = { code: string; nom: string; communes: string[]; d: string; x: number; y: number; w: number; h: number };
export type GeoDepartement = { communes: CommuneGeo[]; epcis: EpciGeo[] };

const cache = new Map<string, { t: number; v: Promise<GeoDepartement> }>();

export function departementValide(dep: string): boolean {
  return /^(\d{2}|2A|2B)$/.test(dep);
}

/** Geojson de l'API Géo → communes projetées. Exporté pour les tests. */
export function versCommunes(features: readonly Feature[]): CommuneGeo[] {
  const out: CommuneGeo[] = [];
  // Les arrondissements n'ont pas d'EPCI dans l'API : ils prennent celui de leur commune.
  const epciParent = new Map(features.filter((f) => DECOUPEES.has(f.properties.code)).map((f) => [f.properties.code, f.properties.codeEpci]));
  for (const f of features) {
    if (!f.geometry || DECOUPEES.has(f.properties.code)) continue;
    const polys = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
    const anneaux = polys.flatMap((p) => p.map((r) => r.map(([lon, lat]) => [lon, lat] as const)));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [lon, lat] of polys.flatMap((p) => p[0] ?? [])) {
      const [x, y] = projeter(lon, lat);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const d = cheminSvg(anneaux);
    if (!d || !Number.isFinite(x0)) continue;
    const r = (n: number) => Math.round(n * 100) / 100;
    out.push({ code: f.properties.code, nom: f.properties.nom, cle: cleCommune(f.properties.nom), cp: f.properties.codesPostaux ?? [], epci: f.properties.codeEpci ?? epciParent.get(parent(f.properties.code)) ?? null, d, x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/** Arrondissement municipal → commune découpée. */
function parent(code: string): string {
  return code.startsWith("751") ? "75056" : code.startsWith("6938") ? "69123" : code.startsWith("132") ? "13055" : "";
}

type Anneau = readonly (readonly [number, number])[];

/**
 * Union de polygones jointifs : une arête partagée par deux communes s'annule, les arêtes restantes se
 * chaînent en anneaux fermés. Les contours de l'API Géo partagent leurs sommets (mesuré le 16/11 : chaque
 * EPCI de l'Isère donne un anneau fermé, aucun ouvert).
 */
export function unionContours(polygones: readonly (readonly Anneau[])[]): [number, number][][] {
  const cle = (p: readonly [number, number]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const aretes = new Map<string, { n: number; de: string; vers: string }>();
  const pts = new Map<string, [number, number]>();
  for (const anneaux of polygones)
    for (const a of anneaux)
      for (let i = 0; i + 1 < a.length; i++) {
        const de = cle(a[i]);
        const vers = cle(a[i + 1]);
        if (de === vers) continue;
        pts.set(de, [a[i][0], a[i][1]]);
        pts.set(vers, [a[i + 1][0], a[i + 1][1]]);
        const k = de < vers ? `${de}|${vers}` : `${vers}|${de}`;
        const e = aretes.get(k);
        if (e) e.n++;
        else aretes.set(k, { n: 1, de, vers });
      }
  const suivants = new Map<string, string[]>();
  for (const e of aretes.values()) if (e.n === 1) suivants.set(e.de, [...(suivants.get(e.de) ?? []), e.vers]);
  const anneaux: [number, number][][] = [];
  for (const depart of suivants.keys()) {
    while (suivants.get(depart)?.length) {
      const r: [number, number][] = [pts.get(depart)!];
      let cur = depart;
      for (;;) {
        const n = suivants.get(cur)?.pop();
        if (n === undefined) break; // anneau ouvert : contours incohérents, on garde ce qui est tracé
        r.push(pts.get(n)!);
        cur = n;
        if (cur === depart) break;
      }
      if (r.length > 3) anneaux.push(r);
    }
  }
  return anneaux;
}

/** Intercommunalités du département, à partir de leurs communes. */
export function versEpcis(features: readonly Feature[], communes: readonly CommuneGeo[], noms: ReadonlyMap<string, string>): EpciGeo[] {
  const geom = new Map(features.map((f) => [f.properties.code, f.geometry]));
  const par = new Map<string, CommuneGeo[]>();
  for (const c of communes) if (c.epci) par.set(c.epci, [...(par.get(c.epci) ?? []), c]);
  const r = (n: number) => Math.round(n * 100) / 100;
  return [...par].map(([code, cs]) => {
    const polys = cs.flatMap((c) => {
      const g = geom.get(c.code);
      if (!g) return [];
      const ps = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
      return ps.map((p) => p.map((a) => a.map(([lon, lat]) => [lon, lat] as const)));
    });
    const x0 = Math.min(...cs.map((c) => c.x));
    const y0 = Math.min(...cs.map((c) => c.y));
    const x1 = Math.max(...cs.map((c) => c.x + c.w));
    const y1 = Math.max(...cs.map((c) => c.y + c.h));
    return { code, nom: noms.get(code) ?? "Intercommunalité", communes: cs.map((c) => c.code), d: cheminSvg(unionContours(polys), 0.03), x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) };
  }).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

async function lire<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`API Géo : HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function charger(dep: string): Promise<GeoDepartement> {
  const [j, noms] = await Promise.all([
    lire<{ features?: Feature[] }>(`${API}?codeDepartement=${dep}&type=commune-actuelle,arrondissement-municipal&format=geojson&geometry=contour&fields=code,nom,codesPostaux,codeEpci`),
    // Sans les noms, les intercommunalités restent dessinées : un échec ici ne casse pas la carte.
    lire<{ code: string; nom: string }[]>(`https://geo.api.gouv.fr/epcis?codeDepartement=${dep}&fields=code,nom`).catch(() => []),
  ]);
  const features = j.features ?? [];
  const communes = versCommunes(features);
  return { communes, epcis: versEpcis(features, communes, new Map(noms.map((e) => [e.code, e.nom]))) };
}

/** Communes et intercommunalités du département, en cache 24 h ; un échec n'est pas gardé. */
export function geometrieCommunes(dep: string): Promise<GeoDepartement> {
  const c = cache.get(dep);
  if (c && Date.now() - c.t < DUREE) return c.v;
  const v = charger(dep);
  cache.set(dep, { t: Date.now(), v });
  v.catch(() => cache.delete(dep));
  return v;
}

export type CommuneComptee = { code: string; nom: string; mesures: Record<string, number> };
export type EpciCompte = { code: string; nom: string; communes: string[]; mesures: Record<string, number> };
export type CommunesRapprochees = { communes: CommuneComptee[]; intercommunalites: EpciCompte[]; non_rapprochees: Record<string, number> };

/** Paris, Lyon, Marseille : la base maître écrit souvent « LYON » ; le code postal donne l'arrondissement. */
function arrondissement(cle: string, cp: string | null): string | null {
  if (!cp) return null;
  const n = Number(cp.slice(-2));
  if (cle === "PARIS" && /^75[01]\d\d$/.test(cp) && n >= 1 && n <= 20) return `751${cp.slice(-2)}`;
  if (cle === "LYON" && /^6900\d$/.test(cp) && n >= 1 && n <= 9) return `6938${n}`;
  if (cle === "MARSEILLE" && /^130\d\d$/.test(cp) && n >= 1 && n <= 16) return `132${cp.slice(-2)}`;
  return null;
}

/**
 * Rattache les comptes bruts aux communes dessinées : par code INSEE (fiches prospectables), sinon par nom
 * (base maître), départagé par le code postal. Ce qui ne se rattache à rien est sommé à part, jamais perdu.
 */
export function rapprocher(geo: readonly CommuneGeo[], brutes: CommunesBrutes, epcis: readonly EpciGeo[] = []): CommunesRapprochees {
  const parCode = new Map(geo.map((g) => [g.code, g]));
  const parCle = new Map<string, CommuneGeo[]>();
  for (const g of geo) parCle.set(g.cle, [...(parCle.get(g.cle) ?? []), g]);
  const comptes = new Map<string, Record<string, number>>();
  const non: Record<string, number> = {};
  const ajouter = (m: Record<string, number>, l: Record<string, number>) => {
    for (const [k, v] of Object.entries(l)) m[k] = (m[k] ?? 0) + v;
  };
  for (const l of brutes.lignes) {
    let g: CommuneGeo | undefined = l.insee ? parCode.get(l.insee) : undefined;
    if (!g) {
      const cle = cleCommune(l.nom);
      const arr = arrondissement(cle, l.code_postal);
      const candidats = arr ? [parCode.get(arr)].filter((x): x is CommuneGeo => !!x) : (parCle.get(cle) ?? []);
      g = candidats.length > 1 && l.code_postal ? (candidats.find((c) => c.cp.includes(l.code_postal!)) ?? candidats[0]) : candidats[0];
    }
    if (!g) {
      ajouter(non, l.mesures);
      continue;
    }
    const m = comptes.get(g.code) ?? {};
    ajouter(m, l.mesures);
    comptes.set(g.code, m);
  }
  const communes = [...comptes].map(([code, mesures]) => ({ code, nom: parCode.get(code)!.nom, mesures }));
  communes.sort((a, b) => (b.mesures.entreprises ?? 0) - (a.mesures.entreprises ?? 0) || a.nom.localeCompare(b.nom, "fr"));
  const intercommunalites = epcis
    .map((e) => {
      const mesures: Record<string, number> = {};
      for (const c of e.communes) ajouter(mesures, comptes.get(c) ?? {});
      return { code: e.code, nom: e.nom, communes: e.communes, mesures };
    })
    .sort((a, b) => (b.mesures.entreprises ?? 0) - (a.mesures.entreprises ?? 0) || a.nom.localeCompare(b.nom, "fr"));
  return { communes, intercommunalites, non_rapprochees: non };
}
