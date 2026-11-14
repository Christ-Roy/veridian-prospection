import type { AxeMarche, MesuresMarche } from "./types";

/** Axes de la vue « Taille du marché », dans l'ordre du sélecteur. */
export const AXES_MARCHE: { id: AxeMarche; libelle: string }[] = [
  { id: "naf", libelle: "Code NAF" },
  { id: "departement", libelle: "Département" },
  { id: "effectif", libelle: "Tranche d'effectif" },
  { id: "forme", libelle: "Type de structure" },
  { id: "forme_juridique", libelle: "Forme juridique (code)" },
  { id: "annee_creation", libelle: "Année de création" },
  { id: "diffusion", libelle: "Diffusion SIRENE" },
];

export type StatutMarche = "actif" | "ferme" | "tous";
export const STATUTS_MARCHE: { id: StatutMarche; libelle: string }[] = [
  { id: "actif", libelle: "Actives" },
  { id: "ferme", libelle: "Fermées" },
  { id: "tous", libelle: "Toutes" },
];

/**
 * Colonnes du tableau. « Connu » = contact trouvé, même écarté ensuite ; « envoyable » = ce qu'on peut
 * promettre à un client (règle d'ODH). Les deux sont montrés, jamais confondus.
 */
export const COLONNES_MARCHE: { id: keyof MesuresMarche; libelle: string; aide: string }[] = [
  { id: "entreprises", libelle: "Entreprises", aide: "Toutes les entreprises de la case, prospectables ou non" },
  { id: "email_connu", libelle: "Email connu", aide: "Un email a été trouvé, même s'il a été écarté ensuite" },
  { id: "email_envoyable", libelle: "Email envoyable", aide: "Email qu'on peut utiliser pour un envoi" },
  { id: "telephone_connu", libelle: "Tél. connu", aide: "Un téléphone a été trouvé" },
  { id: "telephone_envoyable", libelle: "Tél. utilisable", aide: "Téléphone qu'on peut utiliser" },
  { id: "site_connu", libelle: "Site connu", aide: "Un site web a été trouvé" },
  { id: "prospectables", libelle: "Prospectables", aide: "Fiches qu'Atlas peut explorer (non bloquées par ODH)" },
];

/** Part en pour cent, arrondie ; « – » quand le total est nul, « < 1 % » plutôt qu'un 0 trompeur. */
export function part(n: number, total: number): string {
  if (!total) return "–";
  const p = (n * 100) / total;
  if (n > 0 && p < 1) return "< 1 %";
  return `${Math.round(p)} %`;
}

/** Étiquette d'une ligne : code et libellé quand ils diffèrent (NAF), sinon le libellé seul. */
export function etiquetteLigne(cle: string, libelle: string): string {
  return libelle && libelle !== cle && cle ? `${cle} · ${libelle}` : libelle || cle || "Inconnu";
}

/**
 * Créations par année, sans trou (une année sans création vaut 0) : la courbe d'un marché sur `annees` ans,
 * jusqu'à l'année en cours. L'année inconnue (0) est écartée.
 */
export function serieCreations(lignes: readonly { cle: string; entreprises: number }[], fin: number, annees = 15): { annee: number; n: number }[] {
  const par = new Map(lignes.map((l) => [Number(l.cle), l.entreprises]));
  return Array.from({ length: annees }, (_, i) => fin - annees + 1 + i).map((annee) => ({ annee, n: par.get(annee) ?? 0 }));
}

/** Évolution des créations : dernière année complète contre la même année dix ans avant (« × 3 »). */
export function evolution(serie: readonly { annee: number; n: number }[], fin: number): string | null {
  const recent = serie.find((s) => s.annee === fin - 1)?.n ?? 0;
  const ancien = serie.find((s) => s.annee === fin - 11)?.n ?? 0;
  if (!ancien || !recent) return null;
  const r = recent / ancien;
  return r >= 1.5 ? `× ${(Math.round(r * 10) / 10).toLocaleString("fr-FR")} en dix ans` : r <= 0.67 ? `÷ ${(Math.round((1 / r) * 10) / 10).toLocaleString("fr-FR")} en dix ans` : "stable sur dix ans";
}

/**
 * Tranches d'effectif dans l'ordre de taille (codes SIRENE), en classes lisibles. « Non renseignée » reste à
 * part : chez les vétérinaires, 76 % des entreprises n'ont pas de tranche (mesuré le 14/11) ; la mêler au
 * « 0 salarié » ferait lire une absence de donnée comme un fait.
 */
export const CLASSES_EFFECTIF: { libelle: string; codes: string[] }[] = [
  { libelle: "Non renseignée", codes: ["NN"] },
  { libelle: "0 salarié", codes: ["00"] },
  { libelle: "1 à 9", codes: ["01", "02", "03"] },
  { libelle: "10 à 49", codes: ["11", "12"] },
  { libelle: "50 à 249", codes: ["21", "22", "31"] },
  { libelle: "250 et plus", codes: ["32", "41", "42", "51", "52", "53"] },
];
export function parClasseEffectif(lignes: readonly { cle: string; entreprises: number }[]): { libelle: string; n: number }[] {
  return CLASSES_EFFECTIF.map((c) => ({ libelle: c.libelle, n: lignes.filter((l) => c.codes.includes(l.cle)).reduce((a, l) => a + l.entreprises, 0) }));
}
