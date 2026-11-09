/**
 * Fiche entreprise : thèmes ordonnés, libellés, valeurs mises en forme, valeurs vides masquées.
 * Logique pure (testée dans __tests__/atlas-ui).
 */
import { formaterDate, formaterNombre } from "./logique";
import type { Fiche, ValeurFiche } from "./types";

export const THEMES: readonly { id: string; titre: string }[] = [
  { id: "identite", titre: "Identité" },
  { id: "activite", titre: "Activité" },
  { id: "lieu", titre: "Lieu" },
  { id: "dirigeant", titre: "Dirigeant" },
  { id: "contact", titre: "Contact" },
  { id: "web", titre: "Site web" },
  { id: "finances", titre: "Finances" },
  { id: "groupe", titre: "Groupe" },
  { id: "signaux", titre: "Signaux" },
  { id: "qualite", titre: "Qualité" },
];

const LIBELLES: Record<string, string> = {
  siren: "SIREN",
  nom: "Nom",
  forme_juridique: "Forme juridique",
  categorie: "Catégorie",
  date_creation: "Création",
  capital: "Capital",
  statut: "Statut",
  procedure: "Procédure",
  date_procedure: "Date de procédure",
  naf: "Code NAF",
  secteur: "Secteur",
  activite: "Activité",
  services: "Services",
  idcc: "Convention collective",
  opco: "OPCO",
  commune: "Commune",
  code_postal: "Code postal",
  departement: "Département",
  commune_insee: "Code INSEE",
  role: "Rôle",
  email: "Email",
  email_verifie: "Email vérifié",
  type_email: "Type d'email",
  verification: "Vérification",
  messagerie: "Messagerie",
  telephone: "Téléphone",
  delivrable: "Délivrable",
  site: "Adresse",
  domaines: "Domaines",
  niveau: "Niveau du site",
  obsolete: "Site obsolète",
  https: "HTTPS",
  responsive: "Adapté au mobile",
  outil: "Outil",
  ecommerce: "Vente en ligne",
  plateforme_ecommerce: "Plateforme de vente",
  chiffre_affaires: "Chiffre d'affaires",
  resultat_net: "Résultat net",
  ebe: "EBE",
  tresorerie_nette: "Trésorerie nette",
  annee: "Exercice",
  croissance_pct: "Croissance",
  tendance: "Tendance",
  effectif: "Effectif",
  taille: "Taille",
  maison_mere: "Maison mère",
  filiales: "Filiales",
  tete_de_groupe: "Tête de groupe",
  taille_groupe: "Taille du groupe",
  rge: "Label RGE",
  qualiopi: "Qualiopi",
  bio: "Label bio",
  ess: "ESS",
  marches_publics: "Marchés publics",
  montant_marches: "Montant des marchés",
  permis_3_ans: "Permis (3 ans)",
  aides_minimis: "Aides de minimis",
  score_odh: "Score ODH",
  grade: "Grade",
  confiance: "Confiance",
  blocages: "Blocages",
};

const EUROS = new Set(["capital", "chiffre_affaires", "resultat_net", "ebe", "tresorerie_nette", "montant_marches"]);
const DATES = new Set(["date_creation", "date_procedure"]);
/** Coordonnées : utiles à la carte, pas à la lecture. */
const MASQUES = new Set(["lieu.latitude", "lieu.longitude"]);
/** Dans ces thèmes, « non » est l'absence d'un signal : on le masque. */
const FAUX_MASQUE = new Set(["signaux"]);

export function formaterEuros(n: number): string {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`;
  if (Math.abs(n) >= 1e3) return `${formaterNombre(Math.round(n / 1000))} k€`;
  return `${formaterNombre(Math.round(n))} €`;
}

export function formaterSiren(s: string): string {
  return /^\d{9}$/.test(s) ? s.replace(/(\d{3})(?=\d)/g, "$1 ") : s;
}

export type LigneFiche = { cle: string; libelle: string; texte: string; lien?: string; mono?: boolean };
export type ThemeFiche = { id: string; titre: string; lignes: LigneFiche[] };

export function estVide(v: ValeurFiche | undefined, theme = ""): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.filter((x) => x.trim() !== "").length === 0;
  if (typeof v === "boolean") return !v && FAUX_MASQUE.has(theme);
  if (typeof v === "number") return !Number.isFinite(v) || (v === 0 && FAUX_MASQUE.has(theme));
  return false;
}

function lien(cle: string, texte: string): string | undefined {
  if (cle === "site") return /^https?:\/\//i.test(texte) ? texte : `https://${texte}`;
  if (cle === "email" && texte.includes("@")) return `mailto:${texte}`;
  if (cle === "telephone") return `tel:${texte.replace(/[^\d+]/g, "")}`;
  return undefined;
}

export function formaterValeur(cle: string, v: Exclude<ValeurFiche, null>): string {
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (Array.isArray(v)) return v.filter((x) => x.trim() !== "").join(", ");
  if (typeof v === "number") {
    if (EUROS.has(cle)) return formaterEuros(v);
    if (cle === "croissance_pct") return `${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
    if (cle === "annee") return String(v);
    return formaterNombre(v);
  }
  if (DATES.has(cle)) return formaterDate(v);
  if (cle === "siren") return formaterSiren(v);
  return v;
}

/** Thèmes dans l'ordre de la maquette ; valeurs vides et thèmes vides retirés ; thèmes inconnus à la fin. */
export function themesFiche(f: Fiche): ThemeFiche[] {
  const connus = new Set(THEMES.map((t) => t.id));
  const ordre = [...THEMES, ...Object.keys(f).filter((k) => !connus.has(k)).map((id) => ({ id, titre: id }))];
  return ordre
    .map(({ id, titre }) => {
      const brut = f[id] ?? {};
      const lignes: LigneFiche[] = [];
      for (const [cle, v] of Object.entries(brut)) {
        if (MASQUES.has(`${id}.${cle}`) || v === null || estVide(v, id)) continue;
        const texte = formaterValeur(cle, v);
        lignes.push({ cle, libelle: LIBELLES[cle] ?? cle, texte, lien: lien(cle, texte), mono: ["siren", "email", "telephone", "site", "naf", "code_postal", "commune_insee"].includes(cle) });
      }
      return { id, titre, lignes };
    })
    .filter((t) => t.lignes.length > 0);
}

const texte = (v: ValeurFiche | undefined) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** En-tête du volet : « SARL Martin » et « Plomberie · Lyon (69) ». */
export function enteteFiche(f: Fiche, nomDeRepli = "Entreprise"): { titre: string; sous: string } {
  const id = f.identite ?? {};
  const nom = texte(id.nom) || nomDeRepli;
  const forme = texte(id.forme_juridique);
  const activite = texte(f.activite?.activite) || texte(f.activite?.secteur);
  const commune = texte(f.lieu?.commune);
  const dep = texte(f.lieu?.departement);
  const lieu = commune ? `${commune}${dep ? ` (${dep})` : ""}` : dep;
  return {
    titre: forme && !nom.toUpperCase().startsWith(forme.toUpperCase()) && forme.length <= 6 ? `${forme} ${nom}` : nom,
    sous: [activite, lieu].filter(Boolean).join(" · "),
  };
}
