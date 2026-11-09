/** Types des écrans Atlas : ils reflètent les réponses de POST /api/atlas/{outil}. */

export type TypeChamp = "texte" | "liste" | "nombre" | "date" | "oui_non";

export type ChampInfo = {
  id: string;
  libelle: string;
  type: TypeChamp;
  groupe: string;
  operateurs: string[];
  repartition: boolean;
};

export type ValeurCondition = string | number | boolean | (string | number)[];

export type Condition = { champ: string; op: string; valeur?: ValeurCondition };
export type Critere = Condition & { poids: number };
export type Filtre = { conditions: Condition[]; inclure_bloques?: boolean };
export type Scoring = { criteres: Critere[] };

export type DossierArbre = { id: string; nom: string; parent_id: string | null };
export type SegmentArbre = {
  id: string;
  nom: string;
  dossier_id: string | null;
  parent_id: string | null;
  version: number;
  scoring: number | null;
};
export type Arbre = { dossiers: DossierArbre[]; segments: SegmentArbre[]; peut_ecrire?: boolean };

export type SegmentDetail = {
  id: string;
  nom: string;
  dossier_id: string | null;
  parent_id: string | null;
  colonnes: string[];
  version: number;
  filtre: Filtre;
  filtre_effectif: Filtre;
  scoring: { version: number; criteres: Critere[] } | null;
  total: number;
  donnees_simulees?: boolean;
};

export type Cellule = string | number | boolean | null;
export type LigneMarche = Record<string, Cellule>;

export type ApercuMarche = {
  total: number;
  colonnes: string[];
  page: number;
  parPage: number;
  tri: string;
  lignes: LigneMarche[];
  page_suivante?: number | null;
  donnees_simulees?: boolean;
};

export type RepartitionMarche = {
  champ: string;
  valeurs: { cle: string; nombre: number }[];
  donnees_simulees?: boolean;
};

export type VersionFiltre = { version: number; auteur: string; via: string; note: string | null; date: string; filtre: Filtre };
export type VersionScoring = { version: number; auteur: string; via: string; note: string | null; date: string; criteres: Critere[] };
export type Historique = { filtre: VersionFiltre[]; scoring: VersionScoring[] };

export type Vue = "tableau" | "carte" | "repartition";
