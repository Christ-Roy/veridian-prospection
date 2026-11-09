/** Lignes de l'éditeur de conditions (filtres et critères de scoring) : brouillons validés avant envoi. */
import { construireCondition, lirePoids, operateurParDefaut, saisieDepuis, saisieVide, type Saisie, POIDS_MAX, POIDS_MIN } from "./logique";
import type { ChampInfo, Condition, Critere } from "./types";

export type LigneEditeur = { cle: string; champ: string; op: string; saisie: Saisie; poids: string };

let compteur = 0;
const nouvelleCle = () => `l${++compteur}`;

export function nouvelleLigne(champ: ChampInfo, poids = "10"): LigneEditeur {
  return { cle: nouvelleCle(), champ: champ.id, op: operateurParDefaut(champ), saisie: saisieVide(), poids };
}

export function lignesDepuis(conditions: readonly (Condition & { poids?: number })[]): LigneEditeur[] {
  return conditions.map((c) => ({ cle: nouvelleCle(), champ: c.champ, op: c.op, saisie: saisieDepuis(c), poids: c.poids === undefined ? "10" : String(c.poids) }));
}

export type Validation<T> = { ok: true; valeur: T[] } | { ok: false; erreurs: string[] };

function valider<T>(lignes: readonly LigneEditeur[], champs: ReadonlyMap<string, ChampInfo>, fabrique: (c: Condition, l: LigneEditeur) => T | string): Validation<T> {
  const erreurs: string[] = [];
  const valeur: T[] = [];
  for (const l of lignes) {
    const champ = champs.get(l.champ);
    if (!champ) {
      erreurs.push(`champ inconnu « ${l.champ} »`);
      continue;
    }
    const r = construireCondition(champ, l.op, l.saisie);
    if (!r.ok) {
      erreurs.push(r.erreur);
      continue;
    }
    const f = fabrique(r.condition, l);
    if (typeof f === "string") erreurs.push(`${champ.libelle} : ${f}`);
    else valeur.push(f);
  }
  return erreurs.length ? { ok: false, erreurs } : { ok: true, valeur };
}

export function validerConditions(lignes: readonly LigneEditeur[], champs: ReadonlyMap<string, ChampInfo>): Validation<Condition> {
  return valider<Condition>(lignes, champs, (c) => c);
}

export function validerCriteres(lignes: readonly LigneEditeur[], champs: ReadonlyMap<string, ChampInfo>): Validation<Critere> {
  const r = valider<Critere>(lignes, champs, (c, l) => {
    const poids = lirePoids(l.poids);
    return poids === null ? `poids entre ${POIDS_MIN} et ${POIDS_MAX}` : { ...c, poids };
  });
  if (r.ok && r.valeur.length === 0) return { ok: false, erreurs: ["ajoutez au moins un critère"] };
  return r;
}
