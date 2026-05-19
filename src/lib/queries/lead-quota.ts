/**
 * Lead quota system — controls how many leads a tenant can see.
 *
 * Plans:
 *   - freemium: 300 leads (score≥25), proportional by score tier,
 *               restricted to tenant's geo zone + sector
 *   - geo:      all leads in tenant's geo zone (departments), all sectors
 *   - full:     all 996K leads, no restriction
 *
 * The 300 freemium leads are distributed proportionally by score tier
 * to avoid giving only top leads (which would be exhausted quickly):
 *   - bronze (25-39): ~46% → 138 leads
 *   - silver (40-59): ~48% → 143 leads
 *   - gold (60-79):   ~6%  → 18 leads
 *   - diamond (80+):  ~0.3% → 1 lead
 */

/**
 * Plans supportés. Source de vérité §3.3 du CONTRAT-HUB.md.
 *
 * - freemium : quota cap, restrictions zone+secteur (default trial / free)
 * - starter, pro, enterprise : payants Stripe, caps croissants
 * - geo, full : alias historiques (cf checkout flow) — gardés pour
 *   backward-compat ; mappent vers les plans contractuels en interne
 * - lifetime_site_vitrine, lifetime_partner, internal : offerts, quota
 *   illimité, immune au downgrade Stripe
 */
export type TenantPlan =
  | "freemium"
  | "starter"
  | "pro"
  | "enterprise"
  | "geo"
  | "full"
  | "lifetime_site_vitrine"
  | "lifetime_partner"
  | "internal";

export interface LeadQuotaConfig {
  plan: TenantPlan;
  maxLeads: number | null; // null = unlimited
  departments: string[]; // allowed departments (empty = all)
  sectors: string[]; // allowed sectors (empty = all)
}

const FREEMIUM_LIMIT = 300;
const FREEMIUM_MIN_SCORE = 25;

/**
 * Build a SQL WHERE clause + LIMIT that enforces the tenant's lead quota.
 *
 * Returns { where: string, limit: number | null } to be injected
 * into the prospects query.
 */
export function buildQuotaFilter(config: LeadQuotaConfig): {
  where: string;
  limit: number | null;
} {
  const clauses: string[] = [];

  switch (config.plan) {
    case "full":
    case "enterprise":
    case "pro":
    // Plans offerts §3.3 — quota illimité, jamais de feature lockée.
    case "lifetime_site_vitrine":
    case "lifetime_partner":
    case "internal":
      // No restriction — see everything
      return { where: "1=1", limit: null };

    case "starter":
      // Starter : zone + sector restrictions mais pas de cap leads (5k DB-side
      // côté PLAN_LIMITS — ce filtre SQL ne s'occupe pas du cap, c'est
      // getTenantProspectLimit qui le gère).
      if (config.departments.length > 0) {
        const depts = config.departments
          .map((d) => `'${d.replace(/'/g, "''")}'`)
          .join(",");
        clauses.push(`e.departement IN (${depts})`);
      }
      if (config.sectors.length > 0) {
        const secs = config.sectors
          .map((s) => `'${s.replace(/'/g, "''")}'`)
          .join(",");
        clauses.push(`e.secteur_final IN (${secs})`);
      }
      return {
        where: clauses.length > 0 ? clauses.join(" AND ") : "1=1",
        limit: null,
      };

    case "geo":
      // All leads in their geo zone, no lead count limit
      if (config.departments.length > 0) {
        const depts = config.departments.map(d => `'${d.replace(/'/g, "''")}'`).join(",");
        clauses.push(`e.departement IN (${depts})`);
      }
      return { where: clauses.length > 0 ? clauses.join(" AND ") : "1=1", limit: null };

    case "freemium":
    default:
      // 300 leads, score≥25, in their zone + sector
      clauses.push(`e.prospect_score >= ${FREEMIUM_MIN_SCORE}`);
      if (config.departments.length > 0) {
        const depts = config.departments.map(d => `'${d.replace(/'/g, "''")}'`).join(",");
        clauses.push(`e.departement IN (${depts})`);
      }
      if (config.sectors.length > 0) {
        const secs = config.sectors.map(s => `'${s.replace(/'/g, "''")}'`).join(",");
        clauses.push(`e.secteur_final IN (${secs})`);
      }
      return {
        where: clauses.join(" AND "),
        limit: FREEMIUM_LIMIT,
      };
  }
}

/**
 * SQL subquery that selects exactly N leads distributed proportionally
 * by score tier. Used as a CTE or subquery to pre-filter the prospect pool.
 *
 * The distribution mirrors the overall DB distribution so freemium users
 * get a realistic sample, not just the cream.
 */
export function buildFreemiumLeadPoolSQL(
  departments: string[],
  sectors: string[],
  limit: number = FREEMIUM_LIMIT,
): string {
  const baseWhere = [
    "is_registrar = false",
    "COALESCE(ca_suspect, false) = false",
    `prospect_score >= ${FREEMIUM_MIN_SCORE}`,
  ];

  if (departments.length > 0) {
    const depts = departments.map(d => `'${d.replace(/'/g, "''")}'`).join(",");
    baseWhere.push(`departement IN (${depts})`);
  }
  if (sectors.length > 0) {
    const secs = sectors.map(s => `'${s.replace(/'/g, "''")}'`).join(",");
    baseWhere.push(`secteur_final IN (${secs})`);
  }

  const where = baseWhere.join(" AND ");

  // Proportional allocation by score tier using window functions
  // Each tier gets its fair share of the total limit
  return `
    WITH scored_pool AS (
      SELECT siren,
        CASE
          WHEN prospect_score >= 80 THEN 'diamond'
          WHEN prospect_score >= 60 THEN 'gold'
          WHEN prospect_score >= 40 THEN 'silver'
          ELSE 'bronze'
        END AS tier,
        ROW_NUMBER() OVER (
          PARTITION BY CASE
            WHEN prospect_score >= 80 THEN 'diamond'
            WHEN prospect_score >= 60 THEN 'gold'
            WHEN prospect_score >= 40 THEN 'silver'
            ELSE 'bronze'
          END
          ORDER BY prospect_score DESC, siren
        ) AS tier_rank,
        COUNT(*) OVER (
          PARTITION BY CASE
            WHEN prospect_score >= 80 THEN 'diamond'
            WHEN prospect_score >= 60 THEN 'gold'
            WHEN prospect_score >= 40 THEN 'silver'
            ELSE 'bronze'
          END
        ) AS tier_total,
        COUNT(*) OVER () AS pool_total
      FROM entreprises
      WHERE ${where}
    )
    SELECT siren FROM scored_pool
    WHERE tier_rank <= GREATEST(1, ROUND(${limit}::numeric * tier_total / NULLIF(pool_total, 0)))
    LIMIT ${limit}
  `;
}
