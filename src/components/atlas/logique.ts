/**
 * Logique pure des écrans Atlas (sans React, sans réseau) : phrases de filtres, construction d'une
 * condition selon le type du champ, arbre des dossiers, filtre de la carte. Testée dans __tests__/atlas-ui.
 */
import type { Arbre, Cellule, ChampInfo, Condition, DossierArbre, Filtre, SegmentArbre, TypeChamp } from "./types";

export const CHAMP_DEPARTEMENT = "departement";

const LIBELLES_OPERATEURS: Record<string, string> = {
  egal: "est égal à",
  contient: "contient",
  renseigne: "renseigné",
  dans: "parmi",
  hors: "hors de",
  min: "au moins",
  max: "au plus",
  entre: "entre",
  apres: "à partir du",
  avant: "avant le",
  est: "est",
};

/** Libellé d'un opérateur pour le menu de l'éditeur. */
export function libelleOperateur(op: string, type: TypeChamp): string {
  if (type === "oui_non" && op === "est") return "est";
  if (op === "renseigne") return "renseigné ou non";
  return LIBELLES_OPERATEURS[op] ?? op;
}

export function indexerChamps(champs: readonly ChampInfo[]): Map<string, ChampInfo> {
  return new Map(champs.map((c) => [c.id, c]));
}

/** Champs regroupés par `groupe`, dans l'ordre du catalogue. */
export function grouperChamps(champs: readonly ChampInfo[]): { groupe: string; champs: ChampInfo[] }[] {
  const groupes = new Map<string, ChampInfo[]>();
  for (const c of champs) groupes.set(c.groupe, [...(groupes.get(c.groupe) ?? []), c]);
  return [...groupes].map(([groupe, liste]) => ({ groupe, champs: liste }));
}

export function formaterNombre(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

/** AAAA-MM-JJ → JJ/MM/AAAA (autre texte rendu tel quel). */
export function formaterDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const TRONQUE = 4;

function listeCourte(valeurs: (string | number)[]): string {
  const l = valeurs.map(String);
  return l.length <= TRONQUE ? l.join(", ") : `${l.slice(0, TRONQUE).join(", ")} et ${l.length - TRONQUE} autre${l.length - TRONQUE > 1 ? "s" : ""}`;
}

/** Une condition en phrase courte : « Département parmi 69, 01 ». */
export function phraseCondition(c: Condition, champs: ReadonlyMap<string, ChampInfo>): string {
  const champ = champs.get(c.champ);
  const nom = champ?.libelle ?? c.champ;
  const v = c.valeur;
  if (c.op === "renseigne") return `${nom} ${v === false ? "non renseigné" : "renseigné"}`;
  if (c.op === "est") return `${nom} : ${v === false ? "non" : "oui"}`;
  if (c.op === "entre" && Array.isArray(v)) return `${nom} entre ${formaterNombre(Number(v[0]))} et ${formaterNombre(Number(v[1]))}`;
  if ((c.op === "apres" || c.op === "avant") && typeof v === "string") return `${nom} ${LIBELLES_OPERATEURS[c.op]} ${formaterDate(v)}`;
  if (Array.isArray(v)) return `${nom} ${LIBELLES_OPERATEURS[c.op] ?? c.op} ${listeCourte(v)}`;
  if (typeof v === "number") return `${nom} ${LIBELLES_OPERATEURS[c.op] ?? c.op} ${formaterNombre(v)}`;
  return `${nom} ${LIBELLES_OPERATEURS[c.op] ?? c.op} ${v === undefined ? "" : `« ${String(v)} »`}`.trim();
}

/** Le filtre en une phrase : conditions jointes par « et ». */
export function phraseFiltre(f: Filtre, champs: ReadonlyMap<string, ChampInfo>): string {
  const parties = f.conditions.map((c) => phraseCondition(c, champs));
  if (f.inclure_bloques) parties.push("bloquées incluses");
  return parties.length ? parties.join(" et ") : "Toutes les entreprises";
}

// ---------------------------------------------------------------- saisie d'une condition

/** Ce que l'utilisateur est en train de saisir pour une condition (avant validation). */
export type Saisie = {
  texte: string;
  liste: string[];
  min: string;
  max: string;
  oui: boolean;
};

export const saisieVide = (): Saisie => ({ texte: "", liste: [], min: "", max: "", oui: true });

export type Construction = { ok: true; condition: Condition } | { ok: false; erreur: string };

/** « 1 500,5 » → 1500.5 ; null si ce n'est pas un nombre. */
export function lireNombre(brut: string): number | null {
  const s = brut.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function dateValide(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Opérateur proposé par défaut quand on choisit un champ. */
export function operateurParDefaut(champ: ChampInfo): string {
  return champ.operateurs[0] ?? "egal";
}

/** Construit la condition envoyée à l'API selon le type du champ ; message lisible si la saisie est incomplète. */
export function construireCondition(champ: ChampInfo, op: string, s: Saisie): Construction {
  if (!champ.operateurs.includes(op)) return { ok: false, erreur: `${champ.libelle} : opérateur impossible` };
  const ok = (valeur: Condition["valeur"]): Construction => ({ ok: true, condition: { champ: champ.id, op, valeur } });
  const ko = (m: string): Construction => ({ ok: false, erreur: `${champ.libelle} : ${m}` });

  if (op === "renseigne" || champ.type === "oui_non") return ok(s.oui);
  switch (champ.type) {
    case "texte": {
      const t = s.texte.trim();
      if (!t) return ko("saisissez un texte");
      return t.length > 200 ? ko("200 caractères au plus") : ok(t);
    }
    case "liste": {
      const l = [...new Set(s.liste.map((x) => x.trim()).filter(Boolean))];
      if (!l.length) return ko("ajoutez au moins une valeur");
      if (l.length > 300) return ko("300 valeurs au plus");
      return l.some((x) => x.length > 100) ? ko("100 caractères au plus par valeur") : ok(l);
    }
    case "nombre": {
      if (op === "entre") {
        const a = lireNombre(s.min);
        const b = lireNombre(s.max);
        if (a === null || b === null) return ko("saisissez deux nombres");
        return a > b ? ko("le minimum dépasse le maximum") : ok([a, b]);
      }
      const n = lireNombre(op === "max" ? s.max : s.min);
      return n === null ? ko("saisissez un nombre") : ok(n);
    }
    case "date": {
      const d = s.texte.trim();
      return dateValide(d) ? ok(d) : ko("date attendue au format AAAA-MM-JJ");
    }
  }
}

/** Saisie à partir d'une condition existante (pour la rééditer). */
export function saisieDepuis(c: Condition): Saisie {
  const s = saisieVide();
  const v = c.valeur;
  if (typeof v === "boolean") s.oui = v;
  else if (typeof v === "string") s.texte = v;
  else if (typeof v === "number") {
    s.min = String(v);
    s.max = String(v);
  } else if (Array.isArray(v)) {
    if (c.op === "entre") {
      s.min = String(v[0] ?? "");
      s.max = String(v[1] ?? "");
    } else s.liste = v.map(String);
  }
  return s;
}

/** Ajoute une ou plusieurs valeurs saisies (virgule, point-virgule, retour) à une liste, sans doublon. */
export function ajouterValeurs(liste: readonly string[], brut: string): string[] {
  const nouvelles = brut.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  return [...new Set([...liste, ...nouvelles])];
}

// ---------------------------------------------------------------- filtres, carte

export function departementsDuFiltre(f: Filtre): string[] {
  const c = f.conditions.find((x) => x.champ === CHAMP_DEPARTEMENT && x.op === "dans" && Array.isArray(x.valeur));
  return c && Array.isArray(c.valeur) ? c.valeur.map(String) : [];
}

/** Remplace la condition « département parmi … » par la sélection de la carte (vide = on l'enlève). */
export function definirDepartements(f: Filtre, codes: readonly string[]): Filtre {
  const autres = f.conditions.filter((x) => !(x.champ === CHAMP_DEPARTEMENT && x.op === "dans"));
  return { ...f, conditions: codes.length ? [...autres, { champ: CHAMP_DEPARTEMENT, op: "dans", valeur: [...codes] }] : autres };
}

/** Le filtre sans les conditions « parmi » d'un champ : la carte garde ainsi tous les départements visibles. */
export function sansConditionsDans(f: Filtre, champ: string): Filtre {
  return { ...f, conditions: f.conditions.filter((c) => !(c.champ === champ && c.op === "dans")) };
}

/** Conditions héritées des segments parents : le filtre effectif place celles du segment d'abord. */
export function conditionsHeritees(effectif: Filtre, propre: Filtre): Condition[] {
  return effectif.conditions.slice(propre.conditions.length);
}

export function combiner(travail: Filtre, heritees: readonly Condition[]): Filtre {
  return { conditions: [...travail.conditions, ...heritees], inclure_bloques: !!travail.inclure_bloques };
}

export function filtresEgaux(a: Filtre, b: Filtre): boolean {
  const norm = (f: Filtre) => JSON.stringify({ c: f.conditions, b: !!f.inclure_bloques });
  return norm(a) === norm(b);
}

// ---------------------------------------------------------------- arbre

export type NoeudArbre =
  | { type: "dossier"; dossier: DossierArbre; enfants: NoeudArbre[] }
  | { type: "segment"; segment: SegmentArbre; enfants: NoeudArbre[] };

/**
 * Arbre d'affichage : dossiers imbriqués ; dans un dossier, les segments sans parent, et sous
 * chaque segment ses segments enfants. Protégé contre les boucles. Les segments sans dossier
 * (ou dont le dossier a disparu) sont à la racine.
 */
export function construireArbre(a: Arbre): NoeudArbre[] {
  const dossierIds = new Set(a.dossiers.map((d) => d.id));
  const segmentIds = new Set(a.segments.map((s) => s.id));
  const vus = new Set<string>();

  const segmentsDe = (parentId: string | null, dossierId: string | null): NoeudArbre[] =>
    a.segments
      .filter((s) => (parentId ? s.parent_id === parentId : (!s.parent_id || !segmentIds.has(s.parent_id)) && (s.dossier_id && dossierIds.has(s.dossier_id) ? s.dossier_id : null) === dossierId))
      .filter((s) => !vus.has(s.id))
      .map((s) => {
        vus.add(s.id);
        return { type: "segment" as const, segment: s, enfants: segmentsDe(s.id, null) };
      });

  const dossiersDe = (parentId: string | null, profondeur: number): NoeudArbre[] =>
    profondeur > 8
      ? []
      : a.dossiers
          .filter((d) => (d.parent_id && dossierIds.has(d.parent_id) ? d.parent_id : null) === parentId)
          .map((d) => ({ type: "dossier" as const, dossier: d, enfants: [...dossiersDe(d.id, profondeur + 1), ...segmentsDe(null, d.id)] }));

  return [...dossiersDe(null, 0), ...segmentsDe(null, null)];
}

/** Chemin lisible d'un segment : « Dossier › Sous-dossier ». */
export function cheminDossier(a: Arbre, dossierId: string | null): string[] {
  const chemin: string[] = [];
  let courant = dossierId;
  for (let i = 0; courant && i < 9; i++) {
    const d = a.dossiers.find((x) => x.id === courant);
    if (!d) break;
    chemin.unshift(d.nom);
    courant = d.parent_id;
  }
  return chemin;
}

// ---------------------------------------------------------------- cellules

/** Valeurs codées d'ODH lues en clair : motif de non-envoi d'un email. Une valeur inconnue reste telle quelle. */
export const VALEURS_LISIBLES: Record<string, Record<string, string>> = {
  motif_email: {
    domaine_mort: "Domaine mort",
    mx_injoignable: "Serveur mail injoignable",
    boite_inexistante: "Boîte inexistante",
    email_disparu_du_site: "Email retiré du site",
    email_placeholder: "Adresse fictive",
    email_role_non_commercial: "Adresse générique non commerciale",
    contact_de_prestataire: "Contact d'un prestataire",
    email_invalide: "Adresse invalide",
  },
};
export function valeurLisible(champ: string, v: string): string {
  return VALEURS_LISIBLES[champ]?.[v] ?? v;
}

export function formaterCellule(v: Cellule | undefined, champ?: ChampInfo): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (typeof v === "number") return formaterNombre(v);
  if (champ?.type === "date") return formaterDate(v);
  return champ ? valeurLisible(champ.id, v) : v;
}

export function libelleColonne(id: string, champs: ReadonlyMap<string, ChampInfo>): string {
  if (id === "score") return "Score";
  return champs.get(id)?.libelle ?? id;
}

/** Colonnes affichées : celles de la réponse ; « score » s'ajoute si les lignes en portent un. */
export function colonnesAffichees(colonnes: readonly string[], lignes: readonly Record<string, Cellule>[]): string[] {
  const cols = [...colonnes];
  if (!cols.includes("score") && lignes.some((l) => "score" in l)) cols.push("score");
  return cols;
}

export const POIDS_MIN = 0.1;
export const POIDS_MAX = 100;

export function lirePoids(brut: string): number | null {
  const n = lireNombre(brut);
  return n !== null && n >= POIDS_MIN && n <= POIDS_MAX ? n : null;
}

/** Pourcentage d'une barre, borné ; 0 si le maximum est nul. */
export function largeurBarre(valeur: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(100, (valeur / max) * 100)) : 0;
}
