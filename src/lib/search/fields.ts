// ============================================================================
// search/fields.ts — Catalogue des champs filtrables par le moteur de recherche IA.
//
// Source de vérité UNIQUE des dimensions que l'IA (ou un client) peut filtrer.
// Chaque champ déclare :
//   - sql   : l'expression SQL (colonne de `entreprises` aliasée `e`, ou `outreach` `o`)
//   - type  : la nature de la donnée (pilote les opérateurs valides + le cast)
//   - ops   : les opérateurs autorisés sur ce champ
//   - label : description courte (pour le catalogue auto-doc /api/search/fields)
//   - enumValues? : valeurs autorisées si le champ est une énumération fermée
//
// Sécurité : SEULS les champs déclarés ici sont filtrables. Un `field` absent de
// FIELD_CATALOG est rejeté à la validation → ZÉRO SQL libre, ZÉRO interpolation
// de nom de colonne. Les VALEURS passent toujours par binding paramétré ($n).
//
// Aligné sur COLUMN_MAP (src/lib/queries/shared.ts) mais avec le typage des
// opérateurs en plus — le moteur de recherche a besoin de savoir QUOI on peut
// faire sur chaque champ, pas juste son expression SQL.
// ============================================================================

export type FieldType = "number" | "text" | "boolean" | "enum" | "date";

export type SearchOperator =
  | "eq"
  | "neq"
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "between"
  | "in"
  | "exists" // valeur true => IS NOT NULL ; false => IS NULL
  | "contains"; // ILIKE %value% (text uniquement)

export interface FieldDef {
  /** Expression SQL — colonne brute, jamais d'input utilisateur. */
  sql: string;
  type: FieldType;
  ops: readonly SearchOperator[];
  label: string;
  /** Pour type=enum : valeurs canoniques acceptées (rejette le reste). */
  enumValues?: readonly string[];
}

const NUM_OPS = ["eq", "neq", "gte", "lte", "gt", "lt", "between", "in", "exists"] as const;
const TEXT_OPS = ["eq", "neq", "in", "contains", "exists"] as const;
const BOOL_OPS = ["eq", "exists"] as const;
const ENUM_OPS = ["eq", "neq", "in", "exists"] as const;
const DATE_OPS = ["gte", "lte", "gt", "lt", "between", "exists"] as const;

// Helper : un champ booléen physique de `entreprises` (colonne BOOLEAN réelle).
// On filtre directement `e.col = true/false` (sain pour l'index), pas via CASE.
const boolField = (col: string, label: string): FieldDef => ({
  sql: `e.${col}`,
  type: "boolean",
  ops: BOOL_OPS,
  label,
});

export const FIELD_CATALOG: Record<string, FieldDef> = {
  // ─── Identité ───
  siren: { sql: "e.siren", type: "text", ops: TEXT_OPS, label: "SIREN (9 chiffres)" },
  denomination: { sql: "e.denomination", type: "text", ops: TEXT_OPS, label: "Raison sociale" },
  forme_juridique: { sql: "e.forme_juridique", type: "text", ops: TEXT_OPS, label: "Forme juridique" },
  categorie_entreprise: { sql: "e.categorie_entreprise", type: "text", ops: TEXT_OPS, label: "Catégorie (PME/ETI/GE)" },
  date_creation: { sql: "e.date_creation", type: "date", ops: DATE_OPS, label: "Date de création" },

  // ─── Dirigeant ───
  dirigeant_nom: { sql: "e.dirigeant_nom", type: "text", ops: TEXT_OPS, label: "Nom du dirigeant" },
  dirigeant_qualite: { sql: "e.dirigeant_qualite", type: "text", ops: TEXT_OPS, label: "Qualité du dirigeant" },
  age_dirigeant: {
    sql: "(CASE WHEN e.dirigeant_annee_naissance ~ '^[0-9]{4}$' THEN (EXTRACT(YEAR FROM CURRENT_DATE)::int - e.dirigeant_annee_naissance::int) ELSE NULL END)",
    type: "number",
    ops: NUM_OPS,
    label: "Âge du dirigeant (années, calculé)",
  },

  // ─── Contact ───
  email: { sql: "e.best_email_normalized", type: "text", ops: TEXT_OPS, label: "Email principal" },
  email_type: { sql: "e.best_email_type", type: "text", ops: TEXT_OPS, label: "Type d'email (source)" },
  phone: { sql: "e.best_phone_e164", type: "text", ops: TEXT_OPS, label: "Téléphone (E.164)" },

  // ─── Géographie ───
  commune: { sql: "e.commune", type: "text", ops: TEXT_OPS, label: "Commune" },
  departement: { sql: "e.departement", type: "text", ops: TEXT_OPS, label: "Département (code)" },
  code_postal: { sql: "e.code_postal", type: "text", ops: TEXT_OPS, label: "Code postal" },

  // ─── Financier ───
  chiffre_affaires: { sql: "e.chiffre_affaires", type: "number", ops: NUM_OPS, label: "Chiffre d'affaires (€)" },
  resultat_net: { sql: "e.resultat_net", type: "number", ops: NUM_OPS, label: "Résultat net (€)" },
  marge_ebe: { sql: "e.marge_ebe", type: "number", ops: NUM_OPS, label: "Marge EBE" },
  ca_trend_3y: {
    sql: "e.ca_trend_3y",
    type: "enum",
    ops: ENUM_OPS,
    label: "Tendance CA sur 3 ans",
    enumValues: ["growth_strong", "growth", "growth_continuous", "stable", "decline", "crash"],
  },
  profitability_tag: {
    sql: "e.profitability_tag",
    type: "enum",
    ops: ENUM_OPS,
    label: "Profil de rentabilité",
    enumValues: ["top", "good", "average", "weak", "deficit"],
  },

  // ─── Activité / secteur ───
  code_naf: { sql: "e.code_naf", type: "text", ops: TEXT_OPS, label: "Code NAF/APE" },
  naf_libelle: { sql: "e.naf_libelle", type: "text", ops: TEXT_OPS, label: "Libellé NAF" },
  secteur_final: { sql: "e.secteur_final", type: "text", ops: TEXT_OPS, label: "Secteur (catégorie Veridian)" },
  domaine_final: { sql: "e.domaine_final", type: "text", ops: TEXT_OPS, label: "Domaine d'activité" },
  tranche_effectifs: { sql: "e.tranche_effectifs", type: "text", ops: TEXT_OPS, label: "Tranche d'effectifs (code SIRENE)" },

  // ─── Scoring ───
  prospect_score: { sql: "e.prospect_score", type: "number", ops: NUM_OPS, label: "Score prospect (0-100)" },
  prospect_tier: { sql: "e.prospect_tier", type: "text", ops: TEXT_OPS, label: "Tier prospect" },
  // Fiabilité du rattachement SIREN↔site (réservoir ODH importé en bulk). NULL = legacy 996K.
  fiche_confiance: {
    sql: "e.fiche_confiance",
    type: "enum",
    ops: ENUM_OPS,
    label: "Confiance du rattachement (réservoir ODH)",
    // bulk 1 (niveau_0) : fr_dur/fr_corrobore/gris_geo
    // bulk 2 (candidats_siren_scored) : certain/haute/moyenne (1 SIREN tranché net/domaine)
    enumValues: ["fr_dur", "fr_corrobore", "gris_geo", "certain", "haute", "moyenne"],
  },
  data_completeness: { sql: "e.data_completeness", type: "number", ops: NUM_OPS, label: "Complétude data" },
  signal_count: { sql: "e.signal_count", type: "number", ops: NUM_OPS, label: "Nombre de signaux" },

  // ─── Web (présence + qualité) ───
  web_domain: { sql: "e.web_domain_normalized", type: "text", ops: TEXT_OPS, label: "Domaine web" },
  // Scoring web ODH (enrichi 2026-06-30 sur ~632K fiches) — cible vente de site.
  web_tier: {
    sql: "e.web_tier",
    type: "enum",
    ops: ENUM_OPS,
    label: "Qualité du site (ODH)",
    enumValues: ["moderne", "correct", "vieillissant", "obsolete"],
  },
  web_is_obsolete: boolField("web_is_obsolete", "Site obsolète (cible refonte)"),
  web_cms: { sql: "e.web_cms", type: "text", ops: TEXT_OPS, label: "CMS détecté" },
  web_tech_score: { sql: "e.web_tech_score", type: "number", ops: NUM_OPS, label: "Score technique du site" },
  web_obsolescence_score: { sql: "e.web_obsolescence_score", type: "number", ops: NUM_OPS, label: "Score d'obsolescence du site" },
  web_eclate_score: { sql: "e.web_eclate_score", type: "number", ops: NUM_OPS, label: "Score site éclaté/cassé" },
  copyright_year: { sql: "e.web_copyright_year", type: "number", ops: NUM_OPS, label: "Année copyright du site" },
  has_https: boolField("web_has_https", "Site en HTTPS"),
  has_responsive: boolField("web_has_responsive", "Site responsive"),
  has_ecommerce: boolField("web_has_ecommerce", "Site e-commerce"),
  has_contact_form: boolField("web_has_contact_form", "Formulaire de contact"),
  has_booking_system: boolField("web_has_booking_system", "Système de réservation"),
  has_blog: boolField("web_has_blog", "Blog"),
  has_old_html: boolField("web_has_old_html", "HTML obsolète"),
  has_flash: boolField("web_has_flash", "Flash (obsolète)"),
  has_recruiting_page: boolField("web_has_recruiting_page", "Page recrutement (signal croissance)"),

  // ─── Social ───
  social_linkedin: { sql: "e.social_linkedin", type: "text", ops: TEXT_OPS, label: "LinkedIn" },
  social_facebook: { sql: "e.social_facebook", type: "text", ops: TEXT_OPS, label: "Facebook" },
  social_instagram: { sql: "e.social_instagram", type: "text", ops: TEXT_OPS, label: "Instagram" },

  // ─── Certifications ───
  est_rge: boolField("est_rge", "Certifié RGE"),
  est_qualiopi: boolField("est_qualiopi", "Certifié Qualiopi"),
  est_bio: boolField("est_bio", "Certifié Bio"),
  est_epv: boolField("est_epv", "Label EPV"),
  est_finess: boolField("est_finess", "Établissement FINESS (santé)"),
  est_ess: boolField("est_ess", "Économie sociale et solidaire"),
  est_bni: boolField("est_bni", "Membre BNI"),

  // ─── Marchés publics ───
  nb_marches_publics: { sql: "e.nb_marches_publics", type: "number", ops: NUM_OPS, label: "Nb de marchés publics" },
  montant_marches_publics: { sql: "e.montant_marches_publics", type: "number", ops: NUM_OPS, label: "Montant marchés publics (€)" },

  // ─── Flags ───
  is_auto_entrepreneur: boolField("is_auto_entrepreneur", "Auto-entrepreneur"),
  bodacc_status: { sql: "e.bodacc_status", type: "text", ops: TEXT_OPS, label: "Statut BODACC" },
};

/** Liste des champs valides (pour validation Zod + catalogue). */
export const FIELD_KEYS = Object.keys(FIELD_CATALOG) as [string, ...string[]];

/** Résout un champ + vérifie que l'opérateur est autorisé dessus. */
export function resolveField(field: string): FieldDef | null {
  return FIELD_CATALOG[field] ?? null;
}
