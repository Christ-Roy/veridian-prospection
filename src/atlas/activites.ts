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

/** Mots significatifs (3 lettres et plus, sans les mots vides), radical court pour attraper les pluriels. */
export function motsCles(mots: string): string[] {
  const vides = new Set(["les", "des", "pour", "avec", "sans", "dans", "aux", "une", "est", "par", "sur", "and"]);
  return [...new Set(normaliser(mots).split(/[^a-z0-9]+/).filter((m) => m.length >= 3 && !vides.has(m)))]
    .map((m) => (m.length > 5 ? m.replace(/(s|x|eurs?|euses?|es)$/, "") : m))
    .slice(0, 5);
}

/** Sous-classes dont le libellé contient TOUS les mots (radicaux). */
export function codesParLibelle(mots: readonly string[]): string[] {
  if (!mots.length) return [];
  return Object.entries(NAF_LIBELLES)
    .filter(([, l]) => {
      const n = normaliser(l);
      return mots.every((m) => n.includes(m));
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
