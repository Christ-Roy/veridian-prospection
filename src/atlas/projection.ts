/**
 * Projection de la carte Atlas : celle des chemins des départements (france-map-data, tirés de
 * france-geojson). Retrouvée le 16/11 par ajustement sur les 94 départements métropolitains :
 * x linéaire en longitude, y en Mercator, écart maximal 0,05 unité. Une entreprise ou une commune
 * projetée ainsi tombe exactement dans son département, sans recadrage approximatif.
 * Pur, sans DOM : servi au navigateur comme au serveur.
 */

const AX = 51.61265964741624;
const BX = 283.8709807684428;
const AY = -55.729838465697426;
const BY = 3359.328914973762;

/** Latitude en degrés Mercator. */
function mercator(lat: number): number {
  return (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
}

/** Longitude, latitude → coordonnées de la carte (viewBox 0 0 800 850). */
export function projeter(lon: number, lat: number): [number, number] {
  return [AX * lon + BX, AY * mercator(lat) + BY];
}

type Pt = readonly [number, number];

/** Douglas-Peucker : retire les sommets à moins de `eps` unités de la ligne qu'ils dessinent. */
export function simplifier(pts: readonly Pt[], eps: number): Pt[] {
  if (pts.length < 3) return [...pts];
  const garder = new Uint8Array(pts.length);
  garder[0] = 1;
  garder[pts.length - 1] = 1;
  const pile: [number, number][] = [[0, pts.length - 1]];
  while (pile.length) {
    const [i, j] = pile.pop()!;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy);
    let k = -1;
    let max = eps;
    for (let n = i + 1; n < j; n++) {
      const [px, py] = pts[n];
      const d = l > 1e-9 ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / l : Math.hypot(px - ax, py - ay);
      if (d > max) {
        max = d;
        k = n;
      }
    }
    if (k > 0) {
      garder[k] = 1;
      pile.push([i, k], [k, j]);
    }
  }
  return pts.filter((_, n) => garder[n]);
}

/**
 * Anneaux (longitude, latitude) → chemin SVG compact : projeté, simplifié à `eps`, au centième, en
 * déplacements relatifs. Un anneau réduit à moins de trois sommets disparaît.
 */
export function cheminSvg(anneaux: readonly (readonly Pt[])[], eps = 0.02): string {
  let d = "";
  for (const anneau of anneaux) {
    const pts = simplifier(
      anneau.map(([lon, lat]) => projeter(lon, lat)),
      eps,
    );
    if (pts.length < 3) continue;
    let px = Math.round(pts[0][0] * 100);
    let py = Math.round(pts[0][1] * 100);
    d += `M${px / 100} ${py / 100}`;
    for (let n = 1; n < pts.length; n++) {
      const x = Math.round(pts[n][0] * 100);
      const y = Math.round(pts[n][1] * 100);
      if (x === px && y === py) continue;
      d += `l${(x - px) / 100} ${(y - py) / 100}`;
      px = x;
      py = y;
    }
    d += "z";
  }
  return d;
}

/**
 * Clé de rapprochement d'un nom de commune : « Saint-Martin-d'Hères », « SAINT-MARTIN-D'HERES » et
 * « St Martin d'Heres » donnent la même. Les arrondissements (« Lyon 3e Arrondissement », « LYON 3EME »)
 * se réduisent à « LYON 3 ».
 */
export function cleCommune(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(\d+)\s*(?:ER|E|EME)\b(?:\s*ARRONDISSEMENT)?/g, "$1")
    .replace(/\bARRONDISSEMENT\b/g, "")
    .replace(/\bSTE\b/g, "SAINTE")
    .replace(/\bST\b/g, "SAINT")
    .replace(/\s+/g, " ")
    .trim();
}
