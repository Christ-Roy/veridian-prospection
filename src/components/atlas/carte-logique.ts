/**
 * Logique pure de la carte Atlas : géographie (régions, titre), couleurs, cadrage de la descente
 * dans un département ou une commune, placement des entreprises (lon/lat) par la projection de la carte.
 * Sans DOM : testée dans __tests__/atlas-ui.
 */
import { projeter } from "@/atlas/projection";

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

export type PointProjete = PointCarte & { x: number; y: number };

/** Place les entreprises à leur position exacte sur la carte (même projection que les départements). */
export function placerPoints(points: readonly PointCarte[]): PointProjete[] {
  return points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => {
      const [x, y] = projeter(p.lon, p.lat);
      return { ...p, x, y };
    });
}

export type GroupePoints = { cle: string; x: number; y: number; points: PointProjete[]; email: number };

/**
 * Points plus proches que `seuil` (unités de la carte) réunis en un seul rond : à la même adresse, aucun zoom ne les séparerait.
 * Chaque point rejoint le groupe le plus proche à sa portée ; l'ordre d'arrivée (les mieux notés d'abord) est gardé.
 */
export function regrouper(points: readonly PointProjete[], seuil: number): GroupePoints[] {
  const groupes: GroupePoints[] = [];
  const cases = new Map<string, GroupePoints[]>();
  const s = Math.max(seuil, 1e-9);
  const i = (v: number) => Math.floor(v / s);
  for (const p of points) {
    let proche: GroupePoints | null = null;
    let d = s;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const g of cases.get(`${i(p.x) + a}:${i(p.y) + b}`) ?? []) {
          const e = Math.hypot(g.x - p.x, g.y - p.y);
          if (e < d) {
            d = e;
            proche = g;
          }
        }
    if (proche) {
      proche.points.push(p);
      if (p.email) proche.email++;
      continue;
    }
    const g: GroupePoints = { cle: p.siren, x: p.x, y: p.y, points: [p], email: p.email ? 1 : 0 };
    groupes.push(g);
    const k = `${i(p.x)}:${i(p.y)}`;
    cases.set(k, [...(cases.get(k) ?? []), g]);
  }
  return groupes;
}

/** Cadre qui sépare les points d'un groupe, ou null s'ils sont au même endroit (la liste s'ouvre alors). */
export function cadreGroupe(g: GroupePoints, largeur: number): [number, number, number, number] | null {
  const xs = g.points.map((p) => p.x);
  const ys = g.points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  const etendue = Math.max(w, h);
  // Le zoom le plus fin doit les séparer, et rapprocher vraiment.
  if (etendue < LARGEUR_MIN / 25 || largeur <= LARGEUR_MIN * 1.05) return null;
  const cote = Math.max(etendue, LARGEUR_MIN / 1.3);
  return cadrageDescente({ x: x + w / 2 - cote / 2, y: y + h / 2 - cote / 2, width: cote, height: cote });
}

/** Cadrage d'une commune : sa boîte, jamais plus petite que `min` unités (un village resterait illisible). */
export function cadrageCommune(b: Boite, min: number): [number, number, number, number] {
  const w = Math.max(b.width, min);
  const h = Math.max(b.height, min);
  return cadrageDescente({ x: b.x + b.width / 2 - w / 2, y: b.y + b.height / 2 - h / 2, width: w, height: h });
}

/** Largeur de vue la plus fine : quelques rues (une unité de la carte vaut environ 1,4 km). */
export const LARGEUR_MIN = 0.25;

/**
 * Zoom libre autour d'un point (x, y) de la carte : facteur > 1 rapproche. La vue garde le ratio de la carte,
 * ne va ni plus près que LARGEUR_MIN ni plus loin que la France entière.
 */
export function zoomerCadre(c: readonly number[], facteur: number, x: number, y: number): [number, number, number, number] {
  const w = Math.min(CARTE_L, Math.max(LARGEUR_MIN, c[2] / facteur));
  const k = w / c[2];
  const h = c[3] * k;
  return [x - (x - c[0]) * k, y - (y - c[1]) * k, w, h];
}

/** Déplacement de la vue de (dx, dy) unités de la carte. */
export function deplacerCadre(c: readonly number[], dx: number, dy: number): [number, number, number, number] {
  return [c[0] - dx, c[1] - dy, c[2], c[3]];
}

/** Mesure de la carte → valeur d'une commune : un nombre, ou une part (%) des entreprises de la commune. */
export function valeurCommune(m: Mesure, mesures: Readonly<Record<string, number>>): number {
  const total = mesures.entreprises ?? 0;
  if (m === "nombre") return total;
  const k = m === "contactable" ? "contactables" : m;
  return total > 0 ? ((mesures[k] ?? 0) / total) * 100 : 0;
}

export type Mesure = "nombre" | "sans_site" | "avec_email" | "contactable" | "email_envoyable";

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
