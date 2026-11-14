/**
 * Trouver les codes NAF d'un métier sans liste figée (Robert, 14/11 : « que l'IA fasse les corrélations »).
 * Deux signaux, rendus côte à côte pour que l'IA (ou l'écran) choisisse et regroupe :
 *  - libellé : les sous-classes NAF officielles dont le libellé contient les mots ;
 *  - usage : les codes réellement portés par les entreprises dont le nom ou l'activité contient les mots
 *    (« chasse » → 9319Z, 9499Z, 9312Z… bien plus que 0170Z). Mesuré sur les fiches que le compte de
 *    l'app peut lire ; la base maître le remplacera quand ODH l'ouvrira.
 * Chaque code porte ses comptes du marché entier (cube) : entreprises actives, contactables, email envoyable.
 */
import { z } from "zod";

import { FiltreInvalide } from "./filtres";
import { NAF_LIBELLES } from "./naf";

export const EntreeActivitesSchema = z.object({
  mots: z.string().trim().min(3).max(60).describe("Le métier en quelques mots, ex. « chasse », « toilettage chien »"),
  limite: z.number().int().min(1).max(40).default(20),
});

/** Minuscules sans accents, pour comparer « Élevage » et « elevage ». */
export function normaliser(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Mots significatifs (3 lettres et plus, sans les mots vides), réduits à leur radical (pluriel, -eur, -age…). */
export function motsCles(mots: string): string[] {
  const vides = new Set(["les", "des", "pour", "avec", "sans", "dans", "aux", "une", "est", "par", "sur", "and"]);
  return [...new Set(normaliser(mots).split(/[^a-z0-9]+/).filter((m) => m.length >= 3 && !vides.has(m)))]
    .map((m) => (m.length > 5 ? m.replace(/(eurs?|euses?|ages?|ieres?|iers?|es|s|x|e)$/, "") : m.replace(/(s|x)$/, "")))
    .slice(0, 5);
}

/**
 * Un radical se cherche comme MOT ENTIER de sa famille (chasse, chasses, chasseur, chasseurs…), jamais comme
 * début de mot : « chass » ne doit pas attraper « Chasseneuil » ni « châssis ». Même motif en SQL et en JS.
 */
export const FAMILLE = "(e|es|s|x|eur|eurs|euse|euses|age|ages|ier|iers|iere|ieres)?";
export function motifMot(radical: string): string {
  return `(^|[^a-z0-9])${radical.replace(/[^a-z0-9]/g, "")}${FAMILLE}([^a-z0-9]|$)`;
}

/** Sous-classes dont le libellé contient TOUS les mots (familles de mots entiers). */
export function codesParLibelle(mots: readonly string[]): string[] {
  if (!mots.length) return [];
  const motifs = mots.map((m) => new RegExp(motifMot(m)));
  return Object.entries(NAF_LIBELLES)
    .filter(([, l]) => {
      const n = normaliser(l);
      return motifs.every((r) => r.test(n));
    })
    .map(([c]) => c);
}

export function validerActivites(brut: unknown) {
  const r = EntreeActivitesSchema.safeParse(brut ?? {});
  if (!r.success) throw new FiltreInvalide(r.error.issues.map((i) => `${i.path.join(".") || "entrée"} : ${i.message}`).join(" ; "));
  const mots = motsCles(r.data.mots);
  if (!mots.length) throw new FiltreInvalide("mots : au moins un mot de 3 lettres");
  return { ...r.data, radicaux: mots };
}

export type CodeActivite = {
  naf: string;
  libelle: string;
  /** « libelle » : le libellé officiel contient les mots ; « usage » : des entreprises du métier portent ce code. */
  signaux: ("libelle" | "usage")[];
  /** Entreprises dont le nom ou l'activité contient les mots, avec ce code (fiches lisibles). */
  par_nom: number;
  entreprises_actives: number;
  contactables: number;
  email_envoyable: number;
};
