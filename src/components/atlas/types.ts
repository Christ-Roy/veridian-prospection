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



export type Vue = "carte" | "marche" | "barres" | "entonnoir" | "tableau" | "priorite";

/** Taille du marché entier (outil analyser_marche, cube d'ODH). */
export type MesuresMarche = {
  entreprises: number; email_connu: number; telephone_connu: number; site_connu: number; un_canal_connu: number;
  prospectables: number; email_envoyable: number; telephone_envoyable: number;
};
export type AxeMarche = "naf" | "departement" | "forme" | "forme_juridique" | "effectif" | "annee_creation" | "statut" | "diffusion";
export type AnalyseMarche = {
  total: MesuresMarche;
  axe: AxeMarche | null;
  lignes: (MesuresMarche & { cle: string; libelle: string })[];
  provenance: { cube_version: string; calcule_le: string; version_prospection: string } | null;
  conditions_ignorees: Condition[];
};

/** Point d'une entreprise sur la carte d'un département (outil points_carte). */
export type PointCarte = { siren: string; nom: string; commune: string; lat: number; lon: number; email: boolean; site: boolean };

export type ValeurFiche = string | number | boolean | null | string[];
/** Fiche par thème (outil fiche_entreprise_atlas) : thème → clé → valeur. */
export type Fiche = Record<string, Record<string, ValeurFiche>>;

export type Epingle = { siren: string; nom: string; note: string | null; auteur: string; via: string; date: string };

export type Boite = { x: number; y: number; width: number; height: number };
