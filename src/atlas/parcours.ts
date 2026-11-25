/**
 * Tournée Google Maps des entreprises d'un dossier : des liens, rien d'autre. Aucune clé, aucun appel à Google, aucun coût.
 * Ordre : le plus proche voisin, en partant de l'entreprise la plus au nord. Un lien Maps porte dix arrêts au plus.
 */
export type Arret = { siren: string; nom: string; lat: number; lon: number };
export const ARRETS_PAR_LIEN = 10;

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
/** Distance à vol d'oiseau, en km. */
export function distance(a: Pick<Arret, "lat" | "lon">, b: Pick<Arret, "lat" | "lon">): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function ordonner(arrets: readonly Arret[]): Arret[] {
  const reste = [...arrets].sort((a, b) => b.lat - a.lat || (a.siren < b.siren ? -1 : 1));
  const suite: Arret[] = [];
  let ici = reste.shift();
  while (ici) {
    suite.push(ici);
    if (!reste.length) break;
    const depuis = ici;
    const k = reste.reduce((m, x, i) => (distance(depuis, x) < distance(depuis, reste[m]) ? i : m), 0);
    ici = reste.splice(k, 1)[0];
  }
  return suite;
}

const point = (a: Arret) => `${a.lat.toFixed(5)},${a.lon.toFixed(5)}`;

/** Un lien par tronçon ; le suivant repart du dernier arrêt. Le départ du premier est la position de l'utilisateur. */
export function liensMaps(arrets: readonly Arret[]): { url: string; arrets: string[] }[] {
  const liens: { url: string; arrets: string[] }[] = [];
  for (let i = 0; i < arrets.length; i += ARRETS_PAR_LIEN) {
    const t = arrets.slice(i, i + ARRETS_PAR_LIEN);
    const u = new URL("https://www.google.com/maps/dir/");
    u.searchParams.set("api", "1");
    if (i > 0) u.searchParams.set("origin", point(arrets[i - 1]));
    u.searchParams.set("destination", point(t[t.length - 1]));
    if (t.length > 1) u.searchParams.set("waypoints", t.slice(0, -1).map(point).join("|"));
    u.searchParams.set("travelmode", "driving");
    liens.push({ url: u.toString(), arrets: t.map((a) => a.nom) });
  }
  return liens;
}

export function tournee(arrets: readonly Arret[]) {
  const suite = ordonner(arrets);
  const km = suite.slice(1).reduce((s, a, i) => s + distance(suite[i], a), 0);
  return { arrets: suite.map((a) => ({ siren: a.siren, nom: a.nom })), vol_oiseau_km: Math.round(km), liens: liensMaps(suite) };
}
