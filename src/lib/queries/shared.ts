import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export { prisma, Prisma };

/**
 * Small-biz fit score for prospects WITHOUT a website.
 *
 * Purpose: surface solid TPE/PME that lack a web presence — quick-close fit
 * for a cheap landing page pitch. Only computed when the entreprise has no
 * detected web domain; returns NULL otherwise so it never pollutes the
 * sorting of the "avec site" segment.
 *
 * Formula (max 100):
 *   +25  tranche_effectifs in (01,02,03) — TPE 1-9 salariés
 *   +25  EBE margin > 10%   (or +15 if > 5%)
 *   +15  chiffre_affaires > 100k€
 *   +15  chiffre_affaires > 500k€        (cumulative with the 100k step)
 *   +15  resultat_net > 0
 *   + 5  best_phone_e164 IS NOT NULL
 *
 * Note on marge_ebe: verified in dev DB via random spot-check — marge_ebe is
 * already stored as a *percentage* (values typically range -50..+100, e.g.
 * 17.041 means 17.04%). A handful of outliers show absurd values in the
 * millions (corrupted rows) — we cap comparisons to reasonable thresholds
 * so those don't earn the full 25pt bonus accidentally.
 */
export const SMALL_BIZ_FIT_SCORE_SQL = `
  CASE
    WHEN e.web_domain_normalized IS NULL
      AND e.web_domain IS NULL
      AND (e.web_domains_all IS NULL OR jsonb_array_length(e.web_domains_all) = 0)
    THEN (
      (CASE WHEN e.tranche_effectifs IN ('01','02','03') THEN 25 ELSE 0 END)
      + (CASE
          -- marge_ebe is a percentage; cap at 100 to ignore corrupted outliers
          WHEN e.marge_ebe > 10 AND e.marge_ebe < 100 THEN 25
          WHEN e.marge_ebe > 5  AND e.marge_ebe < 100 THEN 15
          ELSE 0
        END)
      + (CASE WHEN e.chiffre_affaires > 100000 THEN 15 ELSE 0 END)
      + (CASE WHEN e.chiffre_affaires > 500000 THEN 15 ELSE 0 END)
      + (CASE WHEN e.resultat_net > 0 THEN 15 ELSE 0 END)
      + (CASE WHEN e.best_phone_e164 IS NOT NULL THEN 5 ELSE 0 END)
    )
    ELSE NULL
  END
`;

// ============================================================================
// SIREN-centric SELECT/FROM for the dashboard leads list.
//
// Source of truth: `entreprises` (996K SIREN, 94 cols, from open-data-hub v3.8).
// The `Lead` interface in lib/types.ts is preserved — we use SQL aliases to
// map entreprises columns to the legacy Lead fields.
//
// Convention: ALWAYS filter `is_registrar = false` and `NOT COALESCE(ca_suspect, false)`.
// ============================================================================

/**
 * Build the LEADS_SELECT query with optional tenant filtering on outreach.
 *
 * Column mapping (entreprises → Lead):
 *   e.siren                  → siren              (primary identifier, 9 digits)
 *   e.denomination           → nom_entreprise
 *   e.best_email_normalized  → email
 *   e.best_phone_e164        → phone
 *   e.best_phone_type        → phone_type
 *   e.dirigeant_prenom+nom   → dirigeant
 *   e.dirigeant_qualite      → qualite_dirigeant
 *   e.commune                → ville
 *   e.departement            → departement
 *   e.code_postal            → code_postal
 *   e.tranche_effectifs      → effectifs
 *   e.chiffre_affaires       → ca
 *   e.code_naf               → code_naf
 *   e.forme_juridique        → forme_juridique
 *   e.categorie_entreprise   → categorie
 *   e.web_cms                → cms
 *   e.web_copyright_year     → copyright_year
 *   e.web_has_responsive     → has_responsive (bool → 0/1)
 *   e.web_has_https          → has_https (bool → 0/1)
 *   e.prospect_tier          → niveau
 *   NULL                     → enriched_via (legacy, no equivalent)
 *   e.prospect_score         → prospect_score (NEW: 0-100)
 *   e.secteur_final          → secteur_final
 *   e.domaine_final          → domaine_final
 *   e.is_auto_entrepreneur   → is_auto_entrepreneur
 *   e.est_rge/qualiopi/bio   → est_rge/est_qualiopi/est_bio
 *   e.web_domain_normalized  → web_domain
 *
 * The outreach LEFT JOIN uses `o.siren = e.siren` (both columns renamed to siren).
 */
export function buildLeadsSelect(tenantId: string | null): string {
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  const outreachJoin = `LEFT JOIN outreach o ON o.siren = e.siren AND o.tenant_id = '${effectiveTid}'`;
  return `
  SELECT
    e.siren as domain,
    e.siren,
    COALESCE(e.denomination, '') as nom_entreprise,
    e.best_email_normalized as email,
    NULL::text as dirigeant_email,
    NULL::text as dirigeant_emails_all,
    NULL::text as aliases_found,
    0 as is_catch_all,
    e.best_email_type as mail_provider,
    e.best_phone_e164 as phone,
    CASE
      WHEN e.dirigeant_prenom IS NOT NULL OR e.dirigeant_nom IS NOT NULL
      THEN TRIM(COALESCE(e.dirigeant_prenom,'') || ' ' || COALESCE(e.dirigeant_nom,''))
      ELSE NULL
    END as dirigeant,
    e.dirigeant_qualite as qualite_dirigeant,
    e.commune as ville,
    e.departement as departement,
    e.code_postal as code_postal,
    e.tranche_effectifs as effectifs,
    e.chiffre_affaires as ca,
    e.code_naf as code_naf,
    e.forme_juridique as forme_juridique,
    e.categorie_entreprise as categorie,
    e.web_cms as cms,
    e.web_copyright_year as copyright_year,
    CASE WHEN e.web_has_responsive = true THEN 1 WHEN e.web_has_responsive = false THEN 0 ELSE NULL END as has_responsive,
    CASE WHEN e.web_has_https = true THEN 1 WHEN e.web_has_https = false THEN 0 ELSE NULL END as has_https,
    e.prospect_tier as niveau,
    NULL::text as enriched_via,
    NULL::integer as phone_valid,
    e.best_phone_type as phone_type,
    NULL::integer as phone_test,
    NULL::integer as phone_shared,
    NULL::text as phone_carrier,
    COALESCE(o.status, 'a_contacter') as outreach_status,
    o.notes as outreach_notes,
    o.contacted_date,
    o.contact_method,
    o.qualification,
    o.last_visited,
    o.pipeline_stage,
    o.interest_pct,
    o.deadline::text as deadline,
    o.site_price::numeric as site_price,
    o.acompte_pct,
    o.acompte_amount::numeric as acompte_amount,
    o.monthly_recurring::numeric as monthly_recurring,
    o.annual_deal,
    o.estimated_value::numeric as estimated_value,
    o.real_value::numeric as real_value,
    o.upsell_estimated::numeric as upsell_estimated,
    o.last_interaction_at::text as last_interaction_at,
    NULL::integer as age_dirigeant,
    e.chiffre_affaires,
    e.resultat_net,
    NULL::bigint as ebe,
    e.marge_ebe,
    NULL::bigint as charges_personnel,
    EXTRACT(YEAR FROM e.bilan_date)::integer as annee_comptes,
    e.secteur_final,
    e.domaine_final,
    e.prospect_tier,
    e.prospect_score,
    NULL::integer as confiance_secteur,
    e.data_completeness,
    e.est_rge,
    e.est_qualiopi,
    e.qualiopi_specialite,
    e.est_bio,
    e.est_epv,
    e.est_finess,
    e.est_ess,
    e.est_bni,
    e.est_sur_lbc,
    e.bilan_date,
    e.bodacc_status,
    e.bodacc_nb_procedures,
    e.is_auto_entrepreneur,
    e.nb_marches_publics,
    e.montant_marches_publics,
    e.decp_2024_plus,
    e.date_creation,
    e.categorie_entreprise as categorie_datahub,
    e.denomination,
    COALESCE(
      e.web_domain_normalized,
      e.web_domain,
      (SELECT (elt->>'domain') FROM jsonb_array_elements(e.web_domains_all) elt WHERE (elt->>'is_primary')::boolean = true LIMIT 1),
      (SELECT (elt->>'domain') FROM jsonb_array_elements(e.web_domains_all) elt LIMIT 1)
    ) as web_domain,
    e.web_domains_all,
    e.web_domain_count,
    -- Use BEST (max) tech_score across all domains of this entreprise.
    -- Why: tech_score = modernity of the site; the higher it is, the less the
    -- prospect needs a refonte. We want to surface leads whose BEST site is
    -- still bad (so even their flagship web presence is obsolete), not ding a
    -- good-site entreprise just because they also host an abandoned subdomain.
    -- Fallback on e.web_tech_score (legacy scalar) when web_domains_all is empty.
    COALESCE(
      (
        SELECT MAX((elt->>'tech_score')::numeric)::integer
        FROM jsonb_array_elements(e.web_domains_all) elt
        WHERE elt->>'tech_score' IS NOT NULL
      ),
      e.web_tech_score
    ) as web_tech_score,
    e.web_eclate_score,
    e.signal_count,
    e.source_count,
    ${SMALL_BIZ_FIT_SCORE_SQL} as small_biz_score,
    -- INPI v3.6 financial enrichment
    e.ca_last,
    e.ca_last_year,
    e.ca_trend_3y,
    e.ca_growth_pct_3y,
    e.marge_ebe_pct,
    e.profitability_tag,
    e.deficit_2y,
    e.scaling_rh,
    e.inpi_nb_exercices,
    e.bilan_last_year,
    e.bilan_confidentiality
  FROM entreprises e
  ${outreachJoin}
`;
}

/**
 * Build the LEADS_FROM clause with optional tenant filtering on outreach.
 */
export function buildLeadsFrom(tenantId: string | null): string {
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  const outreachJoin = `LEFT JOIN outreach o ON o.siren = e.siren AND o.tenant_id = '${effectiveTid}'`;
  return `
  FROM entreprises e
  ${outreachJoin}
`;
}

/** WHERE clause snippet: default filters (is_registrar, ca_suspect). Always prepended. */
export const DEFAULT_ENTREPRISES_WHERE = `e.is_registrar = false AND COALESCE(e.ca_suspect, false) = false`;

/** SQL snippet for tenant filtering on outreach join (used in raw queries) */
export function tenantOutreachJoin(tenantId: string | null): string {
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  return `AND o.tenant_id = '${effectiveTid}'`;
}

/** SQL snippet for WHERE clause tenant filtering */
export function tenantWhere(alias: string, tenantId: string | null): string {
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  return `${alias}.tenant_id = '${effectiveTid}'`;
}

// Keep backward-compat constants (no tenant filtering) for non-tenant-aware callers
export const LEADS_SELECT = buildLeadsSelect(null);
export const LEADS_FROM = buildLeadsFrom(null);

// ============================================================================
// COLUMN_MAP — whitelist for user-provided filter fields.
// Maps the filter key name (from UI / query string) to the SQL expression.
// All entries point to columns of `entreprises` (aliased as `e`) or `outreach` (as `o`).
// ============================================================================

export const COLUMN_MAP: Record<string, string> = {
  // Identity
  siren: "e.siren",
  nom_entreprise: "e.denomination",
  denomination: "e.denomination",
  dirigeant: "TRIM(COALESCE(e.dirigeant_prenom,'') || ' ' || COALESCE(e.dirigeant_nom,''))",
  dirigeant_nom: "e.dirigeant_nom",
  dirigeant_prenom: "e.dirigeant_prenom",
  dirigeant_qualite: "e.dirigeant_qualite",
  // Contact
  email: "e.best_email_normalized",
  email_principal: "e.best_email_normalized",
  email_type: "e.best_email_type",
  phone: "e.best_phone_e164",
  phone_principal: "e.best_phone_e164",
  phone_type: "e.best_phone_type",
  // Address
  ville: "e.commune",
  commune: "e.commune",
  departement: "e.departement",
  code_postal: "e.code_postal",
  // Financials
  ca: "e.chiffre_affaires",
  ca_range: "e.chiffre_affaires",
  chiffre_affaires: "e.chiffre_affaires",
  resultat_net: "e.resultat_net",
  marge_ebe: "e.marge_ebe",
  // Company info
  code_naf: "e.code_naf",
  naf_libelle: "e.naf_libelle",
  forme_juridique: "e.forme_juridique",
  categorie: "e.categorie_entreprise",
  categorie_entreprise: "e.categorie_entreprise",
  effectifs: "e.tranche_effectifs",
  tranche_effectifs: "e.tranche_effectifs",
  date_creation: "e.date_creation",
  // Sectors
  secteur_final: "e.secteur_final",
  domaine_final: "e.domaine_final",
  // Scoring
  prospect_score: "e.prospect_score",
  small_biz_score: SMALL_BIZ_FIT_SCORE_SQL,
  prospect_tier: "e.prospect_tier",
  niveau: "e.prospect_tier", // legacy alias
  data_completeness: "e.data_completeness",
  signal_count: "e.signal_count",
  source_count: "e.source_count",
  // Web
  cms: "e.web_cms",
  web_domain: "e.web_domain_normalized",
  web_tech_score: "e.web_tech_score",
  web_eclate_score: "e.web_eclate_score",
  web_obsolescence_score: "e.web_obsolescence_score",
  copyright_year: "e.web_copyright_year",
  copyright_max: "e.web_copyright_year",
  has_responsive: "CASE WHEN e.web_has_responsive = true THEN 1 ELSE 0 END",
  has_https: "CASE WHEN e.web_has_https = true THEN 1 ELSE 0 END",
  has_ecommerce: "CASE WHEN e.web_has_ecommerce = true THEN 1 ELSE 0 END",
  has_contact_form: "CASE WHEN e.web_has_contact_form = true THEN 1 ELSE 0 END",
  has_mentions_legales: "CASE WHEN e.web_has_mentions_legales = true THEN 1 ELSE 0 END",
  has_blog: "CASE WHEN e.web_has_blog = true THEN 1 ELSE 0 END",
  has_booking_system: "CASE WHEN e.web_has_booking_system = true THEN 1 ELSE 0 END",
  has_horaires: "CASE WHEN e.web_has_horaires = true THEN 1 ELSE 0 END",
  has_google_maps: "CASE WHEN e.web_has_google_maps = true THEN 1 ELSE 0 END",
  has_chat_widget: "CASE WHEN e.web_has_chat_widget = true THEN 1 ELSE 0 END",
  has_recruiting_page: "CASE WHEN e.web_has_recruiting_page = true THEN 1 ELSE 0 END",
  has_old_html: "CASE WHEN e.web_has_old_html = true THEN 1 ELSE 0 END",
  has_flash: "CASE WHEN e.web_has_flash = true THEN 1 ELSE 0 END",
  has_layout_tables: "CASE WHEN e.web_has_layout_tables = true THEN 1 ELSE 0 END",
  has_viewport_no_scale: "CASE WHEN e.web_has_viewport_no_scale = true THEN 1 ELSE 0 END",
  has_meta_keywords: "CASE WHEN e.web_has_meta_keywords = true THEN 1 ELSE 0 END",
  has_mixed_content: "CASE WHEN e.web_has_mixed_content = true THEN 1 ELSE 0 END",
  has_lorem_ipsum: "CASE WHEN e.web_has_lorem_ipsum = true THEN 1 ELSE 0 END",
  has_modern_images: "CASE WHEN e.web_has_modern_images = true THEN 1 ELSE 0 END",
  has_favicon: "CASE WHEN e.web_has_favicon = true THEN 1 ELSE 0 END",
  has_minified_assets: "CASE WHEN e.web_has_minified_assets = true THEN 1 ELSE 0 END",
  has_compression: "CASE WHEN e.web_has_compression = true THEN 1 ELSE 0 END",
  // Social
  social_linkedin: "e.social_linkedin",
  social_facebook: "e.social_facebook",
  social_instagram: "e.social_instagram",
  social_twitter: "e.social_twitter",
  // Certifications
  est_rge: "CASE WHEN e.est_rge = true THEN 1 ELSE 0 END",
  est_qualiopi: "CASE WHEN e.est_qualiopi = true THEN 1 ELSE 0 END",
  est_bio: "CASE WHEN e.est_bio = true THEN 1 ELSE 0 END",
  est_epv: "CASE WHEN e.est_epv = true THEN 1 ELSE 0 END",
  est_finess: "CASE WHEN e.est_finess = true THEN 1 ELSE 0 END",
  est_ess: "CASE WHEN e.est_ess = true THEN 1 ELSE 0 END",
  est_bni: "CASE WHEN e.est_bni = true THEN 1 ELSE 0 END",
  est_sur_lbc: "CASE WHEN e.est_sur_lbc = true THEN 1 ELSE 0 END",
  // DECP
  nb_marches_publics: "e.nb_marches_publics",
  montant_marches_publics: "e.montant_marches_publics",
  decp_2024_plus: "e.decp_2024_plus",
  // Flags
  is_auto_entrepreneur: "CASE WHEN e.is_auto_entrepreneur = true THEN 1 ELSE 0 END",
  is_prospectable: "CASE WHEN e.is_prospectable = true THEN 1 ELSE 0 END",
  bodacc_status: "e.bodacc_status",
  // Outreach (joined)
  outreach_status: "COALESCE(o.status, 'a_contacter')",
  last_visited: "o.last_visited",
};

/**
 * Validates a column name against the COLUMN_MAP whitelist.
 * Returns the mapped SQL expression, or null if not whitelisted.
 */
export function safeColumn(name: string): string | null {
  return COLUMN_MAP[name] ?? null;
}

/**
 * Builds a positional parameter string for Postgres raw queries.
 */
export function pgParam(index: number): string {
  return `$${index}`;
}

/**
 * Cast BigInt fields from Prisma $queryRaw results to number.
 */
export function bigIntToNumber(val: unknown): number {
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "number") return val;
  return 0;
}
