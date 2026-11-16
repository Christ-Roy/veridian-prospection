/**
 * Communes d'un département pour la carte : contours officiels (API Géo de l'État, geo.api.gouv.fr,
 * Licence Ouverte), projetés et simplifiés une fois côté serveur, gardés en mémoire 24 h.
 * Paris, Lyon et Marseille sont découpées en arrondissements, comme les adresses d'ODH.
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

type Feature = { properties: { code: string; nom: string; codesPostaux?: string[] }; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } | null };

const cache = new Map<string, { t: number; v: Promise<CommuneGeo[]> }>();

export function departementValide(dep: string): boolean {
  return /^(\d{2}|2A|2B)$/.test(dep);
}

/** Geojson de l'API Géo → communes projetées. Exporté pour les tests. */
export function versCommunes(features: readonly Feature[]): CommuneGeo[] {
  const out: CommuneGeo[] = [];
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
    out.push({ code: f.properties.code, nom: f.properties.nom, cle: cleCommune(f.properties.nom), cp: f.properties.codesPostaux ?? [], d, x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

async function charger(dep: string): Promise<CommuneGeo[]> {
  const url = `${API}?codeDepartement=${dep}&type=commune-actuelle,arrondissement-municipal&format=geojson&geometry=contour&fields=code,nom,codesPostaux`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`API Géo : HTTP ${r.status}`);
  const j = (await r.json()) as { features?: Feature[] };
  return versCommunes(j.features ?? []);
}

/** Communes du département, en cache 24 h ; un échec n'est pas gardé. */
export function geometrieCommunes(dep: string): Promise<CommuneGeo[]> {
  const c = cache.get(dep);
  if (c && Date.now() - c.t < DUREE) return c.v;
  const v = charger(dep);
  cache.set(dep, { t: Date.now(), v });
  v.catch(() => cache.delete(dep));
  return v;
}

export type CommuneComptee = { code: string; nom: string; mesures: Record<string, number> };
export type CommunesRapprochees = { communes: CommuneComptee[]; non_rapprochees: Record<string, number> };

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
export function rapprocher(geo: readonly CommuneGeo[], brutes: CommunesBrutes): CommunesRapprochees {
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
  return { communes, non_rapprochees: non };
}
