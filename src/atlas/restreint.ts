/**
 * Appel de programme sans droit aux coordonnées (src/lib/mcp/coordonnees.ts) : le compilateur de filtres refuse de
 * filtrer sur le TEXTE d'un email ou d'un téléphone. Sinon « email contient contact@ » avec la colonne du site
 * reconstituerait les adresses, ligne par ligne, sans qu'aucune ne soit rendue. Vaut aussi pour les filtres déjà
 * enregistrés et pour les critères de scoring.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const CHAMPS_COORDONNEES = new Set(["email", "telephone"]);
export const ORIENTATION =
  "Dans un programme, les coordonnées (email, téléphone) ne sortent que par extraire_segment (plan payant, 5 000 lignes par jour) : creer_segment avec ce filtre, puis extraire_segment.";

const portee = new AsyncLocalStorage<true>();
export const enRestreint = <T>(f: () => Promise<T>): Promise<T> => portee.run(true, f);
export const devine = (champ: string, op: string): boolean => portee.getStore() === true && CHAMPS_COORDONNEES.has(champ) && op !== "renseigne";
