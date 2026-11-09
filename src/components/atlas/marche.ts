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
