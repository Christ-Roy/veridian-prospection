/**
 * Catalogue des champs Atlas : la donnée telle qu'elle est, sans jugement (« sans site » n'est pas
 * une opportunité en soi, cela dépend de qui regarde). L'utilisateur choisit les colonnes affichées,
 * filtre sur n'importe quel champ, et l'agent l'aide à choisir les champs et poids du scoring.
 *
 * Chaque champ correspond à une expression SQL fixe sur odh.company_prospection_current : c'est la
 * liste blanche. Ajouter un champ = une entrée ici, rien d'autre.
 */
export type TypeChamp = "texte" | "liste" | "nombre" | "date" | "oui_non";

export type Champ = {
  id: string;
  libelle: string;
  type: TypeChamp;
  sql: string;
  groupe: "Identité" | "Activité" | "Lieu" | "Taille et finances" | "Web" | "Contact" | "Signaux" | "Qualité";
  /** Peut servir d'axe de répartition (carte, diagrammes). */
  repartition?: boolean;
};

export const CHAMPS: readonly Champ[] = [
  { id: "siren", libelle: "SIREN", type: "texte", sql: "siren", groupe: "Identité" },
  { id: "nom", libelle: "Nom", type: "texte", sql: "legal_name", groupe: "Identité" },
  { id: "forme_juridique", libelle: "Forme juridique", type: "liste", sql: "legal_form", groupe: "Identité", repartition: true },
  { id: "date_creation", libelle: "Date de création", type: "date", sql: "creation_date", groupe: "Identité" },
  { id: "dirigeant", libelle: "Dirigeant", type: "texte", sql: "director_name", groupe: "Identité" },
  { id: "naf", libelle: "Code NAF", type: "liste", sql: "naf_code", groupe: "Activité", repartition: true },
  { id: "naf_division", libelle: "Division NAF", type: "liste", sql: "naf_division", groupe: "Activité", repartition: true },
  { id: "secteur", libelle: "Secteur", type: "liste", sql: "activity_sector", groupe: "Activité", repartition: true },
  { id: "activite", libelle: "Activité (libellé)", type: "texte", sql: "activity_label", groupe: "Activité" },
  { id: "departement", libelle: "Département", type: "liste", sql: "department", groupe: "Lieu", repartition: true },
  { id: "code_postal", libelle: "Code postal", type: "liste", sql: "postal_code", groupe: "Lieu", repartition: true },
  { id: "commune", libelle: "Commune", type: "texte", sql: "city", groupe: "Lieu", repartition: true },
  { id: "commune_insee", libelle: "Commune (INSEE)", type: "liste", sql: "commune_insee", groupe: "Lieu", repartition: true },
  { id: "taille", libelle: "Taille", type: "liste", sql: "size_band", groupe: "Taille et finances", repartition: true },
  { id: "effectif", libelle: "Tranche d'effectif", type: "liste", sql: "headcount_range", groupe: "Taille et finances", repartition: true },
  { id: "chiffre_affaires", libelle: "Chiffre d'affaires (€)", type: "nombre", sql: "revenue", groupe: "Taille et finances" },
  { id: "resultat_net", libelle: "Résultat net (€)", type: "nombre", sql: "net_income", groupe: "Taille et finances" },
  { id: "tendance_ca", libelle: "Tendance du CA", type: "liste", sql: "revenue_trend", groupe: "Taille et finances", repartition: true },
  { id: "site", libelle: "Site web", type: "texte", sql: "primary_domain", groupe: "Web" },
  { id: "niveau_web", libelle: "Niveau du site", type: "liste", sql: "web_tier", groupe: "Web", repartition: true },
  { id: "cms", libelle: "Outil du site", type: "liste", sql: "cms", groupe: "Web", repartition: true },
  { id: "ecommerce", libelle: "Vente en ligne", type: "oui_non", sql: "is_ecommerce", groupe: "Web" },
  { id: "https", libelle: "HTTPS", type: "oui_non", sql: "has_https", groupe: "Web" },
  { id: "email", libelle: "Email", type: "texte", sql: "email", groupe: "Contact" },
  { id: "email_verification", libelle: "Vérification de l'email", type: "liste", sql: "email_verification", groupe: "Contact", repartition: true },
  { id: "email_preuve", libelle: "Preuve de l'email", type: "liste", sql: "email_verification_basis", groupe: "Contact", repartition: true },
  // Règle d'ODH (09/11) en attendant leur colonne `email_envoyable` : ni boîte inexistante, ni email retiré du site.
  // `deliverable` d'ODH veut dire « joignable par un canal », pas « email envoyable ».
  { id: "email_envoyable", libelle: "Email envoyable", type: "oui_non", sql: "(email != '' AND email_verification != 'n_existe_pas' AND email_verification_basis != 'web_disparu')", groupe: "Contact" },
  { id: "messagerie", libelle: "Messagerie", type: "liste", sql: "mail_provider_group", groupe: "Contact", repartition: true },
  { id: "telephone", libelle: "Téléphone", type: "texte", sql: "phone", groupe: "Contact" },
  { id: "rge", libelle: "Label RGE", type: "oui_non", sql: "label_rge", groupe: "Signaux" },
  { id: "qualiopi", libelle: "Qualiopi", type: "oui_non", sql: "label_qualiopi", groupe: "Signaux" },
  { id: "marches_publics", libelle: "Marchés publics remportés", type: "nombre", sql: "public_contracts_count", groupe: "Signaux" },
  { id: "permis_3_ans", libelle: "Permis de construire (3 ans)", type: "nombre", sql: "pub_permits_3y_count", groupe: "Signaux" },
  { id: "score_odh", libelle: "Score ODH", type: "nombre", sql: "priority_score_v2", groupe: "Qualité" },
  { id: "grade", libelle: "Grade ODH", type: "liste", sql: "lead_grade", groupe: "Qualité", repartition: true },
];

export const CHAMP = new Map(CHAMPS.map((c) => [c.id, c]));

/** Colonnes affichées par défaut dans une vue neuve. */
export const COLONNES_DEFAUT = ["nom", "commune", "departement", "naf", "taille", "chiffre_affaires", "site", "email", "telephone"];

/** Opérateurs permis par type de champ. */
export const OPERATEURS: Record<TypeChamp, readonly string[]> = {
  texte: ["egal", "contient", "renseigne"],
  liste: ["dans", "hors", "renseigne"],
  nombre: ["min", "max", "entre", "renseigne"],
  date: ["apres", "avant"],
  oui_non: ["est"],
};
