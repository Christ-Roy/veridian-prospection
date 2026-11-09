/**
 * Logique pure de la carte Atlas : géographie (régions, titre), couleurs, cadrage de la descente
 * dans un département et projection des entreprises (lon/lat) dans le chemin SVG du département.
 * Sans DOM : testée dans __tests__/atlas-ui.
 */
import type { Boite, Filtre, PointCarte } from "./types";

export const CARTE_L = 800;
export const CARTE_H = 850;
export const VUE_FRANCE: readonly [number, number, number, number] = [0, 0, CARTE_L, CARTE_H];

/** Régions métropolitaines → départements (pour titrer « Auvergne-Rhône-Alpes » plutôt que 12 noms). */
export const REGIONS: Record<string, { nom: string; codes: string[] }> = {
  ARA: { nom: "Auvergne-Rhône-Alpes", codes: ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"] },
  BFC: { nom: "Bourgogne-Franche-Comté", codes: ["21", "25", "39", "58", "70", "71", "89", "90"] },
  BRE: { nom: "Bretagne", codes: ["22", "29", "35", "56"] },
  CVL: { nom: "Centre-Val de Loire", codes: ["18", "28", "36", "37", "41", "45"] },
  COR: { nom: "Corse", codes: ["2A", "2B"] },
  GES: { nom: "Grand Est", codes: ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"] },
  HDF: { nom: "Hauts-de-France", codes: ["02", "59", "60", "62", "80"] },
  IDF: { nom: "Île-de-France", codes: ["75", "77", "78", "91", "92", "93", "94", "95"] },
  NOR: { nom: "Normandie", codes: ["14", "27", "50", "61", "76"] },
  NAQ: { nom: "Nouvelle-Aquitaine", codes: ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"] },
  OCC: { nom: "Occitanie", codes: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"] },
  PDL: { nom: "Pays de la Loire", codes: ["44", "49", "53", "72", "85"] },
  PAC: { nom: "Provence-Alpes-Côte d'Azur", codes: ["04", "05", "06", "13", "83", "84"] },
};

/** « 1 » → « 01 » ; « 2a » → « 2A » ; le reste tel quel. */
export function normaliserDepartement(code: string): string {
  const c = code.trim().toUpperCase();
  return /^\d$/.test(c) ? `0${c}` : c;
}

/** Départements de la condition « département parmi … » (champ `departement`), normalisés. */
export function departementsFiltre(f: Filtre): string[] {
  const codes = new Set<string>();
  for (const c of f.conditions) {
    if (c.champ !== "departement" || c.op !== "dans") continue;
    const v = Array.isArray(c.valeur) ? c.valeur : typeof c.valeur === "string" ? [c.valeur] : [];
    v.forEach((x) => codes.add(normaliserDepartement(String(x))));
  }
  return [...codes];
}

/**
 * Titre géographique d'une zone : « France » sans condition, le nom de la région quand ses
 * départements y sont tous, sinon les noms des départements (« Rhône, Isère et 3 autres »).
 */
export function titreZone(codes: readonly string[], noms: Readonly<Record<string, string>>): string {
  if (!codes.length) return "France";
  const reste = new Set(codes.map(normaliserDepartement));
  const parties: string[] = [];
  for (const r of Object.values(REGIONS)) {
    if (r.codes.every((c) => reste.has(c))) {
      parties.push(r.nom);
      r.codes.forEach((c) => reste.delete(c));
    }
  }
  for (const c of reste) parties.push(noms[c] ?? c);
  return parties.length <= 3 ? parties.join(", ") : `${parties.slice(0, 2).join(", ")} et ${parties.length - 2} autres`;
}

/** Dégradé bleu de la maquette : r ∈ [0, 1] → couleur HSL. */
export function chaleur(r: number): string {
  const k = Math.max(0, Math.min(1, Number.isFinite(r) ? r : 0));
  return `hsl(217 ${Math.round(30 + k * 60)}% ${Math.round(95 - k * 55)}%)`;
}

/** Position relative d'une valeur entre min et max (0,5 si toutes égales). */
export function rang(v: number, min: number, max: number): number {
  return max === min ? 0.5 : (v - min) / (max - min);
}

/** Cadrage de la descente : la boîte du département avec 12 % de marge, au ratio de la carte. */
export function cadrageDescente(b: Boite): [number, number, number, number] {
  const pad = Math.max(b.width, b.height) * 0.12;
  const w = b.width + pad * 2;
  const h = b.height + pad * 2;
  const largeur = Math.max(w, (h * CARTE_L) / CARTE_H);
  const hauteur = (largeur * CARTE_H) / CARTE_L;
  return [b.x + b.width / 2 - largeur / 2, b.y + b.height / 2 - hauteur / 2, largeur, hauteur];
}

/** Interpolation de viewBox avec la courbe de la maquette (sortie cubique). */
export function interpolerCadre(de: readonly number[], vers: readonly number[], t: number): number[] {
  const k = Math.max(0, Math.min(1, t));
  const e = 1 - Math.pow(1 - k, 3);
  return de.map((a, i) => a + ((vers[i] ?? a) - a) * e);
}

/** Correction de la longitude à la latitude moyenne de la France métropolitaine (cos 46°). */
export const COS_LAT = Math.cos((46 * Math.PI) / 180);

function quantile(triees: readonly number[], q: number): number {
  const i = Math.min(triees.length - 1, Math.max(0, Math.round(q * (triees.length - 1))));
  return triees[i];
}

export type PointProjete = PointCarte & { x: number; y: number };

/**
 * Projette les entreprises dans le chemin du département : la boîte englobante des points
 * (longitude × cos 46°, latitude) est mise à l'échelle, sans déformation, dans la boîte du chemin
 * (getBBox) et centrée. Au-delà de 20 points, la boîte est prise entre les 1er et 99e centiles pour
 * qu'une adresse mal géocodée n'écrase pas les autres. Un point qui tombe hors du chemin reste affiché.
 */
export function projeterPoints(points: readonly PointCarte[], b: Boite): PointProjete[] {
  const valides = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!valides.length) return [];
  const xs = valides.map((p) => p.lon * COS_LAT).sort((a, c) => a - c);
  const ys = valides.map((p) => p.lat).sort((a, c) => a - c);
  const q = valides.length > 20 ? 0.01 : 0;
  const minX = quantile(xs, q);
  const maxX = quantile(xs, 1 - q);
  const minY = quantile(ys, q);
  const maxY = quantile(ys, 1 - q);
  const ex = maxX - minX;
  const ey = maxY - minY;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  if (ex <= 0 && ey <= 0) return valides.map((p) => ({ ...p, x: cx, y: cy }));
  const echelle = Math.min(ex > 0 ? b.width / ex : Infinity, ey > 0 ? b.height / ey : Infinity);
  const ox = cx - (ex * echelle) / 2;
  const oy = cy - (ey * echelle) / 2;
  return valides.map((p) => ({ ...p, x: ox + (p.lon * COS_LAT - minX) * echelle, y: oy + (maxY - p.lat) * echelle }));
}

export type Mesure = "nombre" | "sans_site" | "avec_email";

/** Valeurs de la carte par département : nombre, ou part (%) d'une sous-population. */
export function valeursCarte(
  total: readonly { cle: string; nombre: number }[],
  partie: readonly { cle: string; nombre: number }[] | null,
): Map<string, number> {
  const m = new Map<string, number>();
  const p = new Map((partie ?? []).map((x) => [normaliserDepartement(x.cle), x.nombre]));
  for (const x of total) {
    const code = normaliserDepartement(x.cle);
    if (partie) m.set(code, x.nombre > 0 ? ((p.get(code) ?? 0) / x.nombre) * 100 : 0);
    else m.set(code, x.nombre);
  }
  return m;
}

export function bornes(valeurs: Iterable<number>): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of valeurs) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === Infinity ? null : { min, max };
}
