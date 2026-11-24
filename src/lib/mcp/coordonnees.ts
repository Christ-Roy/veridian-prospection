/**
 * Coordonnées et appels de programme (parente, 24/11). Un programme du Hub lit 200 pages d'un coup, réponse entière :
 * pour lui, la seule sortie de coordonnées (email, téléphone) est extraire_segment (plan payant, 5 000 lignes par jour,
 * tracée). Partout ailleurs elles sont retirées, plan payant compris, pour que le quota ne se contourne pas.
 * Exception : l'accès avancé, qui lit déjà la base en SQL.
 *
 * L'en-tête du programme ne donne donc aucun droit ici, il en retire. Son absence ne prouve pas un humain : rien de
 * plus n'est ouvert sans lui. L'appel direct n'est pas concerné (VER-249, décision de Robert).
 *
 * On traite la classe : le retrait lit la sortie de TOUT outil, un outil ajouté demain est couvert sans y penser.
 */
import { CHAMPS_COORDONNEES, ORIENTATION } from "@/atlas/restreint";

import { ErreurOutil } from "./erreur";
import type { ContexteOutil, Outil } from "./outils";

/** Le seul outil qui en rend : il porte son plan, son quota et sa trace. */
const EXEMPTES = new Set(["extraire_segment"]);
const CLES = /^(e?-?mails?|telephones?|tel|phones?|mobiles?)$/i;
/** Ce que l'utilisateur a écrit lui-même (filtres, notes) : jamais lu dans une fiche, donc rendu tel quel. */
const ECRIT_PAR_UTILISATEUR = new Set(["filtre", "filtre_effectif", "conditions", "scoring", "criteres", "note"]);
// Longueurs bornées : sans elles, un texte de 1 Mo sans « @ » occupe le processeur des minutes (vu le 24/11).
const EMAIL = /[\p{L}\d._%+'-]{1,64}@[\p{L}\d-]{1,63}(?:\.[\p{L}\d-]{1,63})+/gu;
const TELEPHONE = /(?<![\w+])(?<!\d[.,])(?:\+\d{1,3}[ .-]?(?:\(0\)[ .-]?)?\d(?:[ .-]?\d){6,12}|0[1-9](?:[ .-]?\d{2}){4})(?!\w)/g;
const RETIRE = "[coordonnée retirée]";

export function sansCoordonnees(outil: Outil, c: ContexteOutil, programme: boolean): boolean {
  return programme && !c.droits?.accesAvance && !EXEMPTES.has(outil.name);
}

/** Refuse tôt une lecture qui demande des coordonnées (ranger ces colonnes dans un segment reste permis). */
export function refuserCoordonnees(outil: Outil, args: Record<string, unknown>): void {
  const demandees = outil.annotations.readOnlyHint && Array.isArray(args.colonnes) ? args.colonnes.filter((x) => CHAMPS_COORDONNEES.has(String(x))) : [];
  if (demandees.length) throw new ErreurOutil(`Colonne refusée ici : ${demandees.join(", ")}. ${ORIENTATION}`);
}

/** Copie de la valeur sans ses coordonnées ; un avis est ajouté si quelque chose a été retiré. */
export function retirerCoordonnees(valeur: unknown): unknown {
  let retire = false;
  const passer = (v: unknown): unknown => {
    if (typeof v === "string") {
      const t = (v.includes("@") ? v.replace(EMAIL, RETIRE) : v).replace(TELEPHONE, RETIRE);
      if (t !== v) retire = true;
      return t;
    }
    if (Array.isArray(v)) return v.map(passer);
    if (!v || typeof v !== "object") return v;
    if (typeof (v as { toJSON?: unknown }).toJSON === "function") return v; // dates
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (ECRIT_PAR_UTILISATEUR.has(k)) o[k] = x;
      // Drapeaux et comptes (email: true, email: 12) : pas une coordonnée.
      else if (CLES.test(k) && typeof x !== "boolean" && typeof x !== "number") retire = true;
      else o[k] = passer(x);
    }
    return o;
  };
  const propre = passer(valeur);
  return retire && propre && typeof propre === "object" && !Array.isArray(propre) ? { ...propre, coordonnees_retirees: ORIENTATION } : propre;
}
