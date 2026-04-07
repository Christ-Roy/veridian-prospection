import { prisma, buildLeadsSelect, buildLeadsFrom, COLUMN_MAP, bigIntToNumber, tenantOutreachJoin, DEFAULT_ENTREPRISES_WHERE } from "./shared";
import type { Lead, LeadDetail } from "../types";
import type { ExportLead } from "../twenty";

interface LeadsParams {
  page: number;
  pageSize: number;
  sort?: string;
  sortDir?: "asc" | "desc";
  filters?: Record<string, string>;
  deduplicate?: boolean;
}

export async function getLeads(params: LeadsParams, tenantId: string | null = null) {
  const { page, pageSize, sort = "prospect_score", sortDir = "desc", filters = {}, deduplicate = false } = params;

  const LEADS_SELECT_T = buildLeadsSelect(tenantId);
  const LEADS_FROM_T = buildLeadsFrom(tenantId);

  // Default filters: is_registrar, ca_suspect
  const whereParts: string[] = [DEFAULT_ENTREPRISES_WHERE];
  const queryParams: (string | number)[] = [];
  let paramIndex = 1;

  // Global search: denomination, phone, email, dirigeant, siren
  if (filters.search) {
    const term = `%${filters.search}%`;
    const searchCols = [
      "e.siren",
      "COALESCE(e.denomination, '')",
      "COALESCE(e.best_phone_e164, '')",
      "COALESCE(e.best_email_normalized, '')",
      "TRIM(COALESCE(e.dirigeant_prenom,'') || ' ' || COALESCE(e.dirigeant_nom,''))",
    ];
    const likeParts = searchCols.map(() => {
      const p = `$${paramIndex++}`;
      queryParams.push(term);
      return p;
    });
    whereParts.push(`(${searchCols.map((c, i) => `${c} ILIKE ${likeParts[i]}`).join(" OR ")})`);
  }

  for (const [field, value] of Object.entries(filters)) {
    if (!value || field === "search" || !COLUMN_MAP[field]) continue;
    const col = COLUMN_MAP[field];

    if (value === "!empty") {
      whereParts.push(`(${col} IS NOT NULL AND ${col}::text != '')`);
    } else if (value === "empty") {
      whereParts.push(`(${col} IS NULL OR ${col}::text = '')`);
    } else if (value.startsWith("!=")) {
      whereParts.push(`(${col} IS NULL OR ${col} != $${paramIndex++})`);
      queryParams.push(value.slice(2));
    } else if (value.startsWith("!")) {
      const raw = value.slice(1);
      const values = raw.split(",").map(v => v.trim()).filter(Boolean);
      if (values.length === 1) {
        whereParts.push(`(${col} IS NULL OR ${col} != $${paramIndex++})`);
        queryParams.push(values[0]);
      } else if (values.length > 1) {
        const placeholders = values.map(() => `$${paramIndex++}`).join(",");
        whereParts.push(`(${col} IS NULL OR ${col} NOT IN (${placeholders}))`);
        queryParams.push(...values);
      }
    } else if (value.startsWith(">=")) {
      whereParts.push(`(${col} IS NOT NULL AND ${col} >= $${paramIndex++})`);
      queryParams.push(Number(value.slice(2)));
    } else if (value.startsWith("<=")) {
      whereParts.push(`(${col} IS NOT NULL AND ${col} <= $${paramIndex++})`);
      queryParams.push(Number(value.slice(2)));
    } else if (/^\d+-\d+$/.test(value)) {
      const [min, max] = value.split("-").map(Number);
      whereParts.push(`(${col} IS NOT NULL AND ${col} >= $${paramIndex++} AND ${col} <= $${paramIndex++})`);
      queryParams.push(min, max);
    } else if (value.includes(",")) {
      const values = value.split(",").map(v => v.trim());
      const placeholders = values.map(() => `$${paramIndex++}`).join(",");
      whereParts.push(`${col} IN (${placeholders})`);
      queryParams.push(...values);
    } else if (value.startsWith("=")) {
      whereParts.push(`${col} = $${paramIndex++}`);
      queryParams.push(value.slice(1));
    } else {
      whereParts.push(`${col} = $${paramIndex++}`);
      queryParams.push(value);
    }
  }

  const where = whereParts.join(" AND ");
  const groupBy = deduplicate ? "GROUP BY e.siren" : "";
  const sortCol = COLUMN_MAP[sort] ?? "e.prospect_score";
  const dir = sortDir === "desc" ? "DESC NULLS LAST" : "ASC NULLS LAST";

  // Total count query
  let countQuery = `SELECT COUNT(*) as count ${LEADS_FROM_T} WHERE ${where}`;
  if (deduplicate) {
    countQuery = `SELECT COUNT(*) as count FROM (SELECT 1 ${LEADS_FROM_T} WHERE ${where} ${groupBy}) sub`;
  }

  const limitParam = `$${paramIndex++}`;
  const offsetParam = `$${paramIndex++}`;
  const offset = (page - 1) * pageSize;

  const totalResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(countQuery, ...queryParams);
  const total = bigIntToNumber(totalResult[0].count);

  const dataQuery = `${LEADS_SELECT_T} WHERE ${where} ${groupBy} ORDER BY ${sortCol} ${dir}, e.siren ASC LIMIT ${limitParam} OFFSET ${offsetParam}`;
  const rows = await prisma.$queryRawUnsafe<Lead[]>(dataQuery, ...queryParams, pageSize, offset);

  // Cast bigint ca field + other bigint fields
  const data = rows.map(row => {
    const out = { ...row } as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === "bigint") out[k] = Number(v);
    }
    return out as unknown as Lead;
  });

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Get full lead detail by SIREN (9 digits).
 * Fetches the entreprises row and maps it to the LeadDetail interface.
 */
export async function getLeadDetail(siren: string, tenantId: string | null = null): Promise<LeadDetail | null> {
  const LEADS_SELECT_T = buildLeadsSelect(tenantId);
  const leadRows = await prisma.$queryRawUnsafe<Lead[]>(
    `${LEADS_SELECT_T} WHERE e.siren = $1 AND ${DEFAULT_ENTREPRISES_WHERE}`,
    siren
  );
  const lead = leadRows[0];
  if (!lead) return null;

  // Fetch full entreprises row for extra fields that aren't in the LEADS_SELECT shape
  const fullRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    "SELECT * FROM entreprises WHERE siren = $1",
    siren
  );
  const full = fullRows[0];

  // Convert all BigInt fields to Number (for JSON serialization)
  const safeLead = Object.fromEntries(
    Object.entries(lead).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])
  ) as unknown as Lead;

  const fullSafe = full
    ? Object.fromEntries(
        Object.entries(full).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])
      )
    : {};

  return {
    ...safeLead,
    // LeadDetail extra fields
    phones: (fullSafe.best_phone_e164 as string) ?? null,
    emails: (fullSafe.best_email_normalized as string) ?? null,
    siret: (fullSafe.siret_siege as string) ?? null,
    siren: (fullSafe.siren as string) ?? siren,
    tva_intracom: null,
    address: (fullSafe.adresse as string) ?? null,
    generator: null,
    platform_name: (fullSafe.web_platform as string) ?? null,
    jquery_version: null,
    php_version: null,
    social_linkedin: (fullSafe.social_linkedin as string) ?? null,
    social_facebook: (fullSafe.social_facebook as string) ?? null,
    social_instagram: (fullSafe.social_instagram as string) ?? null,
    social_twitter: (fullSafe.social_twitter as string) ?? null,
    final_url: null,
    title: null,
    meta_description: null,
    api_adresse: (fullSafe.adresse as string) ?? null,
    // CNB data — dropped during SIREN refactor (legacy niche, may be re-added)
    cnb_nom: null,
    cnb_prenom: null,
    cnb_barreau: null,
    cnb_specialite1: null,
    cnb_specialite2: null,
    cnb_date_serment: null,
    est_encore_avocat: null,
    obsolescence_score: (fullSafe.web_obsolescence_score as number) ?? null,
    // PJ fields dropped — no more pj_leads table in the schema
    pj_id: null,
    pj_url: null,
    pj_website_url: null,
    activites_pj: null,
    pj_description: null,
    rating_pj: null,
    nb_avis_pj: null,
    is_solocal: null,
    solocal_tier: null,
    honeypot_score: null,
    honeypot_flag: null,
    honeypot_reasons: null,
    is_pj_lead: false,
  };
}

export async function getHistoryLeads(limit = 200, tenantId: string | null = null): Promise<Lead[]> {
  const LEADS_SELECT_T = buildLeadsSelect(tenantId);
  const rows = await prisma.$queryRawUnsafe<Lead[]>(
    `${LEADS_SELECT_T}
     WHERE ${DEFAULT_ENTREPRISES_WHERE}
       AND o.last_visited IS NOT NULL
     ORDER BY o.last_visited DESC
     LIMIT $1`,
    limit
  );
  return rows.map(row => {
    const out = { ...row } as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === "bigint") out[k] = Number(v);
    }
    return out as unknown as Lead;
  });
}

/**
 * Export leads by SIREN list.
 * Used by the Twenty CRM export feature.
 */
export async function getLeadsBySiren(sirens: string[], tenantId: string | null = null): Promise<ExportLead[]> {
  if (sirens.length === 0) return [];
  const toj = tenantOutreachJoin(tenantId);
  const placeholders = sirens.map((_, i) => `$${i + 1}`).join(",");
  const rows = await prisma.$queryRawUnsafe<ExportLead[]>(
    `SELECT
      e.siren AS domain,
      e.web_domain_normalized as web_domain,
      COALESCE(e.denomination, '') as nom_entreprise,
      e.adresse as api_adresse,
      e.commune as api_ville,
      e.code_postal as api_code_postal,
      e.tranche_effectifs as api_effectifs,
      e.chiffre_affaires as api_ca,
      e.social_linkedin,
      e.social_twitter,
      e.dirigeant_prenom as api_dirigeant_prenom,
      e.dirigeant_nom as api_dirigeant_nom,
      e.dirigeant_qualite as api_dirigeant_qualite,
      NULL::text as dirigeant_email,
      e.best_email_normalized as email_principal,
      e.best_phone_e164 as phone_principal,
      o.notes as outreach_notes,
      o.status as outreach_status,
      o.contacted_date,
      o.qualification,
      NULL::text as cnb_barreau,
      NULL::text as cnb_specialite1,
      NULL::text as cnb_date_serment,
      NULL::integer as est_encore_avocat
    FROM entreprises e
    LEFT JOIN outreach o ON o.siren = e.siren ${toj}
    WHERE e.siren IN (${placeholders})
      AND ${DEFAULT_ENTREPRISES_WHERE}`,
    ...sirens
  );
  return rows.map(row => ({
    ...row,
    api_ca: row.api_ca !== null ? Number(row.api_ca) : null,
  }));
}

// Legacy alias (kept for transition; will be removed once callers migrate)
export const getLeadsByDomains = getLeadsBySiren;
