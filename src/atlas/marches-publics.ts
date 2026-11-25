/**
 * Pages publiques de marché (VISION-ATLAS R1, lead magnet) : sans compte, que des comptes du cube d'ODH. Aucune entreprise nommée,
 * aucune coordonnée, aucun paramètre libre : une page par code NAF officiel, donc 732 au plus, gardées 24 h.
 */
import { NAF_LIBELLES } from "./naf";
import { TRANCHES, type Mesures } from "./cube";
import { slug } from "./api-marches";
import { sourceMarche } from "./source";

const JOUR = 24 * 3600 * 1000;
/** Un échec se retente vite, sans marteler la base. */
const ECHEC = 60_000;
const cache = new Map<string, { t: number; v: Promise<unknown>; ko?: boolean }>();

export function _oublier(): void {
  cache.clear();
}
async function garder<T>(cle: string, f: () => Promise<T>): Promise<T> {
  const c = cache.get(cle);
  if (c && Date.now() - c.t < (c.ko ? ECHEC : JOUR)) return c.v as Promise<T>;
  const e: { t: number; v: Promise<unknown>; ko?: boolean } = { t: Date.now(), v: f() };
  e.v.catch(() => {
    e.ko = true;
    e.t = Date.now();
  });
  cache.set(cle, e);
  return e.v as Promise<T>;
}

/** « 7500z-activites-veterinaires » ou « 7500Z » → le code, s'il existe. */
export function lireNaf(param: string): string | null {
  const c = /^(\d{4}[a-z])(?:-|$)/i.exec(param)?.[1].toUpperCase();
  return c && Object.hasOwn(NAF_LIBELLES, c) ? c : null;
}
export const cheminMarche = (naf: string): string => `/marche/${naf.toLowerCase()}-${slug(NAF_LIBELLES[naf] ?? "")}`;

export type MarchePublic = {
  naf: string;
  libelle: string;
  total: Mesures;
  departements: { libelle: string; n: number }[];
  tailles: { libelle: string; n: number }[];
  creations: { annee: number; n: number }[];
  calcule_le: string | null;
};
const TAILLES = ["00", "01", "02", "03", "11", "12", "21", "22", "31", "32", "41", "42", "51", "52", "53"];

export function marchePublic(naf: string, annee = new Date().getFullYear()): Promise<MarchePublic> {
  return garder(`m:${naf}`, async () => {
    const s = sourceMarche();
    const axe = (a: "departement" | "effectif" | "annee_creation", limite: number) => s.marche({ naf: [naf], axe: a, limite });
    const [dep, eff, an] = await Promise.all([axe("departement", 120), axe("effectif", 30), axe("annee_creation", 200)]);
    return {
      naf,
      libelle: NAF_LIBELLES[naf],
      total: dep.total,
      departements: dep.lignes.filter((l) => l.cle && l.cle !== "99").slice(0, 12).map((l) => ({ libelle: l.libelle, n: l.entreprises })),
      tailles: TAILLES.map((k) => ({ libelle: TRANCHES[k], n: eff.lignes.find((l) => l.cle === k)?.entreprises ?? 0 })).filter((x) => x.n > 0),
      creations: Array.from({ length: 15 }, (_, i) => annee - 14 + i).map((a) => ({ annee: a, n: an.lignes.find((l) => Number(l.cle) === a)?.entreprises ?? 0 })),
      calcule_le: dep.provenance?.calcule_le ?? null,
    };
  });
}

/** Les marchés par nombre d'entreprises (500 au plus), pour l'index. */
export function marchesPublics(): Promise<{ naf: string; libelle: string; n: number }[]> {
  return garder("index", async () => {
    const r = await sourceMarche().marche({ axe: "naf", limite: 500 });
    return r.lignes.filter((l) => Object.hasOwn(NAF_LIBELLES, l.cle)).map((l) => ({ naf: l.cle, libelle: NAF_LIBELLES[l.cle], n: l.entreprises }));
  });
}
