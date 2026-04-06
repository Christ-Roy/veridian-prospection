// Queries for the prospect navigation (domains + sectorial presets)
// 2026-04-05: Refactored to SIREN-centric — now queries the `entreprises` table.

import { prisma, bigIntToNumber, tenantWhere, DEFAULT_ENTREPRISES_WHERE, SMALL_BIZ_FIT_SCORE_SQL } from "./shared";
import { DOMAINS, getDomainNafCodes, type ProspectPreset } from "../domains";

function buildProspectSelectFields(tenantId: string | null): string {
  const twCa = tenantWhere("ca", tenantId);
  return `
  e.siren as domain,
  e.siren,
  COALESCE(e.denomination, '') as nom_entreprise,
  e.best_email_normalized as email,
  NULL::text as dirigeant_email,
  e.best_phone_e164 as phone,
  TRIM(COALESCE(e.dirigeant_prenom,'') || ' ' || COALESCE(e.dirigeant_nom,'')) as dirigeant,
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
  NULL::text as enriched_via,
  NULL::integer as phone_valid,
  e.best_phone_type as phone_type,
  NULL::integer as phone_shared,
  COALESCE(o.status, 'a_contacter') as outreach_status,
  o.notes as outreach_notes,
  o.contacted_date,
  o.contact_method,
  o.qualification,
  o.last_visited,
  COALESCE(
    (SELECT MAX((elt->>'tech_score')::numeric)::integer FROM jsonb_array_elements(e.web_domains_all) elt WHERE elt->>'tech_score' IS NOT NULL),
    e.web_tech_score,
    0
  ) as tech_score,
  COALESCE(e.web_eclate_score, 0) as eclate_score,
  e.prospect_tier,
  e.prospect_score,
  e.ca_trend_3y,
  e.profitability_tag,
  e.secteur_final,
  e.domaine_final,
  e.is_auto_entrepreneur,
  COALESCE(
    e.web_domain_normalized,
    e.web_domain,
    (SELECT (elt->>'domain') FROM jsonb_array_elements(e.web_domains_all) elt WHERE (elt->>'is_primary')::boolean = true LIMIT 1),
    (SELECT (elt->>'domain') FROM jsonb_array_elements(e.web_domains_all) elt LIMIT 1)
  ) as web_domain,
  e.web_domain_count,
  ${SMALL_BIZ_FIT_SCORE_SQL} as small_biz_score,
  (SELECT COUNT(*) FROM claude_activity ca WHERE ca.siren = e.siren AND ${twCa}) as claude_activity_count
`;
}

function buildProspectFrom(tenantId: string | null): string {
  const outreachJoin = tenantId !== null
    ? `LEFT JOIN outreach o ON o.siren = e.siren AND (o.tenant_id = '${tenantId}' OR o.tenant_id IS NULL)`
    : `LEFT JOIN outreach o ON o.siren = e.siren AND o.tenant_id IS NULL`;
  return `
  FROM entreprises e
  ${outreachJoin}
`;
}

// Build NAF WHERE clause for a domain
function buildDomainNafWhere(domainId: string): { sql: string; params: (string | number)[] } {
  if (domainId === "all") return { sql: "1=1", params: [] };

  const naf = getDomainNafCodes(domainId);
  if (!naf) return { sql: "1=1", params: [] };

  const parts: string[] = [];
  const params: (string | number)[] = [];

  if (naf.nafExact.length > 0) {
    parts.push(`e.code_naf IN (${naf.nafExact.map(() => "?").join(",")})`);
    params.push(...naf.nafExact);
  }
  for (const prefix of naf.nafPrefixes) {
    parts.push(`e.code_naf LIKE ?`);
    params.push(`${prefix}%`);
  }

  return { sql: parts.length > 0 ? `(${parts.join(" OR ")})` : "1=1", params };
}

// Base condition: always applied. Exclude registrars, ca_suspect, and known bad rows.
const PRESET_BASE = `${DEFAULT_ENTREPRISES_WHERE} AND (e.is_prospectable IS NULL OR e.is_prospectable = true) AND (e.bodacc_status IS NULL OR e.bodacc_status != 'liquidation')`;

function getPresetWhereForSingle(preset: ProspectPreset): string {
  const naf = `e.code_naf`;
  switch (preset) {
    case "top_prospects":
      return `(${PRESET_BASE} AND e.prospect_score >= 60 AND e.best_phone_e164 IS NOT NULL)`;
    case "btp_artisans":
      return `(${PRESET_BASE} AND (${naf} LIKE '43%' OR ${naf} LIKE '41%'))`;
    case "sante_droit":
      return `(${PRESET_BASE} AND (${naf} LIKE '86%' OR ${naf} LIKE '69%' OR ${naf} LIKE '71%'))`;
    case "commerce_services":
      return `(${PRESET_BASE} AND (${naf} LIKE '55%' OR ${naf} LIKE '56%' OR ${naf} LIKE '45%' OR ${naf} LIKE '47%' OR ${naf} LIKE '96%' OR ${naf} LIKE '93%'))`;
    case "tous":
      return `(${PRESET_BASE} AND e.best_phone_e164 IS NOT NULL)`;
    case "historique":
      return `(o.last_visited IS NOT NULL)`;
    // Sans-site sidebar presets (certifications + residual)
    case "rge":
      return `(${PRESET_BASE} AND e.est_rge = true)`;
    case "qualiopi":
      return `(${PRESET_BASE} AND e.est_qualiopi = true)`;
    case "bio":
      return `(${PRESET_BASE} AND e.est_bio = true)`;
    case "epv":
      return `(${PRESET_BASE} AND e.est_epv = true)`;
    case "bni":
      return `(${PRESET_BASE} AND e.est_bni = true)`;
    case "non_identifie_avec_tel":
      return `(${PRESET_BASE} AND COALESCE(e.est_rge,false)=false AND COALESCE(e.est_qualiopi,false)=false AND COALESCE(e.est_bio,false)=false AND COALESCE(e.est_epv,false)=false AND COALESCE(e.est_bni,false)=false AND e.best_phone_e164 IS NOT NULL)`;
    default:
      // Unknown preset — fallback to base filter to avoid SQL injection
      return `(${PRESET_BASE})`;
  }
}

function getPresetWhere(presets: ProspectPreset[]): string {
  if (presets.length === 1) return getPresetWhereForSingle(presets[0]);
  return `(${presets.map(p => getPresetWhereForSingle(p)).join(" OR ")})`;
}

// Sort mapping (table-qualified for direct queries)
const SORT_MAP: Record<string, string> = {
  siren: "e.siren",
  nom_entreprise: "e.denomination",
  ville: "e.commune",
  effectifs: "e.tranche_effectifs",
  ca: "e.chiffre_affaires",
  tech_score: "e.web_tech_score",
  eclate_score: "e.web_eclate_score",
  copyright_year: "e.web_copyright_year",
  prospect_score: "e.prospect_score",
  small_biz_score: SMALL_BIZ_FIT_SCORE_SQL,
  outreach_status: "COALESCE(o.status, 'a_contacter')",
  last_visited: "o.last_visited",
};

// Sort mapping for subquery context (column aliases from SELECT)
const SORT_MAP_ALIAS: Record<string, string> = {
  siren: "siren",
  nom_entreprise: "nom_entreprise",
  ville: "ville",
  effectifs: "effectifs",
  ca: "ca",
  tech_score: "tech_score",
  eclate_score: "eclate_score",
  copyright_year: "copyright_year",
  prospect_score: "prospect_score",
  small_biz_score: "small_biz_score",
  outreach_status: "outreach_status",
  last_visited: "last_visited",
};

// --- Filter types used by the API ---
export interface ProspectFilters {
  search?: string;
  secteurs?: string[];
  domaines?: string[];
  depts?: string[];
  effectifsCodes?: string[];
  mobileOnly?: boolean;
  caMin?: number | null;
  caMax?: number | null;
  caRanges?: { min: number | null; max: number | null }[];
  sizeOperator?: "and" | "or";
  hideDuplicateSiren?: boolean;
  unseenOnly?: boolean;
  minTechScore?: number;
  minProspectScore?: number;
  requirePhone?: boolean;
  requireEmail?: boolean;
  requireDirigeant?: boolean;
  requireEnriched?: boolean;
  excludeAssociations?: boolean;
  excludePhoneShared?: boolean;
  excludeHttpDead?: boolean;
  excludeAutoEntrepreneurs?: boolean;
  requireRge?: boolean;
  requireQualiopi?: boolean;
  requireBio?: boolean;
  requireEpv?: boolean;
  requireBni?: boolean;
  /** Filter by specific Qualiopi specialite text (matches entreprises.qualiopi_specialite). */
  qualiopiSpecialite?: string;
  /** Leads without any certification but with a phone number — residual "non identifié". */
  nonIdentifieAvecTel?: boolean;
  /** "with" = only prospects with a known web domain; "without" = only prospects without. */
  hasWebsite?: "with" | "without" | null;
  /** Restrict to outreach rows owned by this user (visibility_scope='own'). */
  userFilter?: string;
  /** Pre-computed SIREN pool for freemium quota enforcement. */
  quotaPool?: string[];
}

function buildFilterWhere(filters: ProspectFilters): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.search) {
    const term = `%${filters.search}%`;
    clauses.push(`(e.siren ILIKE ? OR e.denomination ILIKE ? OR e.dirigeant_nom ILIKE ? OR e.best_phone_e164 ILIKE ? OR e.best_email_normalized ILIKE ?)`);
    params.push(term, term, term, term, term);
  }

  if (filters.secteurs && filters.secteurs.length > 0) {
    const ph = filters.secteurs.map(() => "?").join(",");
    clauses.push(`e.secteur_final IN (${ph})`);
    params.push(...filters.secteurs);
  }
  if (filters.domaines && filters.domaines.length > 0) {
    const ph = filters.domaines.map(() => "?").join(",");
    clauses.push(`e.domaine_final IN (${ph})`);
    params.push(...filters.domaines);
  }

  if (filters.depts && filters.depts.length > 0) {
    const placeholders = filters.depts.map(() => "?").join(",");
    clauses.push(`e.departement IN (${placeholders})`);
    params.push(...filters.depts);
  }

  const effClauses: string[] = [];
  const caClauses: string[] = [];

  if (filters.effectifsCodes && filters.effectifsCodes.length > 0) {
    const placeholders = filters.effectifsCodes.map(() => "?").join(",");
    effClauses.push(`e.tranche_effectifs IN (${placeholders})`);
    params.push(...filters.effectifsCodes);
  }

  if (filters.caRanges && filters.caRanges.length > 0) {
    const rangeParts: string[] = [];
    for (const range of filters.caRanges) {
      const parts: string[] = [];
      if (range.min != null) { parts.push("e.chiffre_affaires >= ?"); params.push(range.min); }
      if (range.max != null) { parts.push("e.chiffre_affaires < ?"); params.push(range.max); }
      if (parts.length > 0) rangeParts.push("(" + parts.join(" AND ") + ")");
      else rangeParts.push("e.chiffre_affaires IS NOT NULL");
    }
    caClauses.push("(" + rangeParts.join(" OR ") + ")");
  } else {
    if (filters.caMin != null) {
      caClauses.push("e.chiffre_affaires >= ?");
      params.push(filters.caMin);
    }
    if (filters.caMax != null) {
      caClauses.push("e.chiffre_affaires <= ?");
      params.push(filters.caMax);
    }
  }

  const combined: string[] = [];
  if (effClauses.length > 0) combined.push("(" + effClauses.join(" AND ") + ")");
  if (caClauses.length > 0) combined.push("(" + caClauses.join(" AND ") + ")");

  if (combined.length > 0) {
    const op = (filters.sizeOperator ?? "or") === "and" ? " AND " : " OR ";
    clauses.push("(" + combined.join(op) + ")");
  }

  if (filters.mobileOnly) {
    clauses.push("e.best_phone_type = 'mobile'");
  }

  if (filters.unseenOnly) {
    clauses.push("o.last_visited IS NULL");
  }
  if (filters.minTechScore && filters.minTechScore > 0) {
    clauses.push(`e.web_tech_score >= ?`);
    params.push(filters.minTechScore);
  }
  if (filters.minProspectScore && filters.minProspectScore > 0) {
    clauses.push(`e.prospect_score >= ?`);
    params.push(filters.minProspectScore);
  }

  if (filters.requirePhone) {
    clauses.push("e.best_phone_e164 IS NOT NULL");
  }
  if (filters.requireEmail) {
    clauses.push("e.best_email_normalized IS NOT NULL");
  }
  if (filters.requireDirigeant) {
    clauses.push("(e.dirigeant_nom IS NOT NULL AND e.dirigeant_nom != '')");
  }

  if (filters.excludeAssociations) {
    // associations are already excluded from entreprises during enrichment
    // (is_prospectable=false) — no-op for back-compat
  }
  if (filters.excludeAutoEntrepreneurs) {
    clauses.push("(e.is_auto_entrepreneur IS NULL OR e.is_auto_entrepreneur = false)");
  }

  if (filters.requireRge) clauses.push("e.est_rge = true");
  if (filters.requireQualiopi) clauses.push("e.est_qualiopi = true");
  if (filters.requireBio) clauses.push("e.est_bio = true");
  if (filters.requireEpv) clauses.push("e.est_epv = true");
  if (filters.requireBni) clauses.push("e.est_bni = true");
  if (filters.qualiopiSpecialite) {
    clauses.push("e.qualiopi_specialite = ?");
    params.push(filters.qualiopiSpecialite);
  }
  if (filters.nonIdentifieAvecTel) {
    // No certification of any kind, but we have a phone — the residual pile
    // worth a cold-call sweep even without a label to lean on.
    clauses.push(
      "(COALESCE(e.est_rge,false)=false AND COALESCE(e.est_qualiopi,false)=false AND COALESCE(e.est_bio,false)=false AND COALESCE(e.est_epv,false)=false AND COALESCE(e.est_bni,false)=false AND e.best_phone_e164 IS NOT NULL)"
    );
  }

  if (filters.hasWebsite === "with") {
    clauses.push(
      "(e.web_domain_normalized IS NOT NULL OR e.web_domain IS NOT NULL OR (e.web_domains_all IS NOT NULL AND jsonb_array_length(e.web_domains_all) > 0))"
    );
  } else if (filters.hasWebsite === "without") {
    clauses.push(
      "(e.web_domain_normalized IS NULL AND e.web_domain IS NULL AND (e.web_domains_all IS NULL OR jsonb_array_length(e.web_domains_all) = 0))"
    );
  }

  // Visibility scope: restrict to outreach rows belonging to this user.
  // The outreach table is LEFT JOINed as `o` — when userFilter is set, we
  // want to exclude rows where o.user_id doesn't match (or is NULL).
  if (filters.userFilter) {
    clauses.push("o.user_id = ?");
    params.push(filters.userFilter);
  }

  // Freemium quota pool: restrict to pre-selected SIREN list
  if (filters.quotaPool && filters.quotaPool.length > 0) {
    const ph = filters.quotaPool.map(() => "?").join(",");
    clauses.push(`e.siren IN (${ph})`);
    params.push(...filters.quotaPool);
  }

  return {
    sql: clauses.length > 0 ? clauses.join(" AND ") : "1=1",
    params,
  };
}

function toPositionalParams(sql: string, startIndex = 1): string {
  let idx = startIndex;
  return sql.replace(/\?/g, () => `$${idx++}`);
}

interface ProspectParams {
  domainId: string;
  presets: ProspectPreset[];
  page: number;
  pageSize: number;
  sort?: string;
  sortDir?: "asc" | "desc";
  filters?: ProspectFilters;
}

export async function getProspects(params: ProspectParams, tenantId: string | null = null) {
  const { domainId, presets, page, pageSize, sort = "prospect_score", sortDir = "desc", filters = {} } = params;

  const PROSPECT_SELECT_FIELDS = buildProspectSelectFields(tenantId);
  const PROSPECT_FROM = buildProspectFrom(tenantId);

  const { sql: nafSql, params: nafParams } = buildDomainNafWhere(domainId);
  const presetSql = getPresetWhere(presets);
  const { sql: filterSql, params: filterParams } = buildFilterWhere(filters);

  const defaultUnseenSql = (presets.length === 1 && presets[0] === "top_prospects" && !filters.unseenOnly) ? " AND o.last_visited IS NULL" : "";

  const whereSql = `${nafSql} AND ${presetSql} AND ${filterSql}${defaultUnseenSql}`;
  const allParams = [...nafParams, ...filterParams];

  const sortCol = SORT_MAP[sort] ?? "e.prospect_score";
  const dir = sortDir === "desc" ? "DESC" : "ASC";

  // SIREN dedup is now a no-op because each row is already 1 SIREN.
  // Keep the flag for backward compat with the UI.
  const countSqlRaw = `
    SELECT COUNT(*) as count
    ${PROSPECT_FROM}
    WHERE ${whereSql}
  `;
  const countSql = toPositionalParams(countSqlRaw);
  const totalResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(countSql, ...allParams);
  const total = bigIntToNumber(totalResult[0].count);

  const offset = (page - 1) * pageSize;
  const limitIdx = allParams.length + 1;
  const offsetIdx = allParams.length + 2;
  const dataSqlRaw = `
    SELECT ${PROSPECT_SELECT_FIELDS}
    ${PROSPECT_FROM}
    WHERE ${whereSql}
    ORDER BY ${sortCol} ${dir} NULLS LAST, e.siren ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;
  const dataSql = toPositionalParams(dataSqlRaw);
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(dataSql, ...allParams, pageSize, offset);

  return {
    data: rows.map(r => ({
      ...r,
      ca: r.ca !== null && r.ca !== undefined ? Number(r.ca as bigint | number) : null,
      claude_activity_count: bigIntToNumber(r.claude_activity_count),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// Unused sort_map alias export for backward compat
export const _SORT_MAP_ALIAS = SORT_MAP_ALIAS;

// Get counts for all domains for a given preset(s)
export async function getDomainCounts(presets: ProspectPreset[], filters?: ProspectFilters, tenantId: string | null = null): Promise<Record<string, number>> {
  const PROSPECT_FROM = buildProspectFrom(tenantId);
  const counts: Record<string, number> = {};
  const presetSql = getPresetWhere(presets);
  const { sql: filterSql, params: filterParams } = buildFilterWhere(filters ?? {});

  // "all" domain count
  const allCountSql = toPositionalParams(`
    SELECT COUNT(*) as count
    ${PROSPECT_FROM}
    WHERE ${presetSql} AND ${filterSql}
  `);
  const allCountResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(allCountSql, ...filterParams);
  counts["all"] = bigIntToNumber(allCountResult[0].count);

  // Per domain, batch with CASE WHEN
  const caseParts: string[] = [];
  const params: (string | number)[] = [];

  for (const domain of DOMAINS) {
    if (domain.id === "all") continue;
    const naf = getDomainNafCodes(domain.id);
    if (!naf) { counts[domain.id] = 0; continue; }

    const nafParts: string[] = [];
    if (naf.nafExact.length > 0) {
      nafParts.push(`e.code_naf IN (${naf.nafExact.map(() => "?").join(",")})`);
      params.push(...naf.nafExact);
    }
    for (const prefix of naf.nafPrefixes) {
      nafParts.push(`e.code_naf LIKE ?`);
      params.push(`${prefix}%`);
    }

    if (nafParts.length > 0) {
      caseParts.push(`SUM(CASE WHEN ${nafParts.join(" OR ")} THEN 1 ELSE 0 END) as "${domain.id}"`);
    }
  }

  if (caseParts.length > 0) {
    const PROSPECT_FROM_inner = buildProspectFrom(tenantId);
    const rawSql = `
      SELECT ${caseParts.join(", ")}
      ${PROSPECT_FROM_inner}
      WHERE ${presetSql} AND ${filterSql}
    `;
    const allP = [...params, ...filterParams];
    const sql = toPositionalParams(rawSql);
    const row = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(sql, ...allP);

    if (row[0]) {
      for (const domain of DOMAINS) {
        if (domain.id === "all") continue;
        counts[domain.id] = bigIntToNumber(row[0][domain.id]) ?? 0;
      }
    }
  }

  return counts;
}

// Get counts for all presets for a given domain
export async function getPresetCounts(domainId: string, filters?: ProspectFilters, tenantId: string | null = null): Promise<Record<ProspectPreset, number>> {
  const { sql: nafSql, params: nafParams } = buildDomainNafWhere(domainId);
  const { sql: filterSql, params: filterParams } = buildFilterWhere(filters ?? {});
  const allParams = [...nafParams, ...filterParams];
  const naf = `e.code_naf`;

  const rawSql = `
    SELECT
      SUM(CASE WHEN
        ${PRESET_BASE}
        AND e.prospect_score >= 60
        AND e.best_phone_e164 IS NOT NULL
      THEN 1 ELSE 0 END) as "top_prospects",
      SUM(CASE WHEN
        ${PRESET_BASE}
        AND (${naf} LIKE '43%' OR ${naf} LIKE '41%')
      THEN 1 ELSE 0 END) as "btp_artisans",
      SUM(CASE WHEN
        ${PRESET_BASE}
        AND (${naf} LIKE '86%' OR ${naf} LIKE '69%' OR ${naf} LIKE '71%')
      THEN 1 ELSE 0 END) as "sante_droit",
      SUM(CASE WHEN
        ${PRESET_BASE}
        AND (${naf} LIKE '55%' OR ${naf} LIKE '56%' OR ${naf} LIKE '45%' OR ${naf} LIKE '47%' OR ${naf} LIKE '96%' OR ${naf} LIKE '93%')
      THEN 1 ELSE 0 END) as "commerce_services",
      SUM(CASE WHEN
        ${PRESET_BASE}
        AND e.best_phone_e164 IS NOT NULL
      THEN 1 ELSE 0 END) as "tous",
      SUM(CASE WHEN o.last_visited IS NOT NULL THEN 1 ELSE 0 END) as "historique"
    ${buildProspectFrom(tenantId)}
    WHERE ${nafSql} AND ${filterSql}
  `;
  const sql = toPositionalParams(rawSql);
  const result = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(sql, ...allParams);
  const row = result[0];

  return {
    top_prospects: bigIntToNumber(row?.["top_prospects"]) ?? 0,
    btp_artisans: bigIntToNumber(row?.["btp_artisans"]) ?? 0,
    sante_droit: bigIntToNumber(row?.["sante_droit"]) ?? 0,
    commerce_services: bigIntToNumber(row?.["commerce_services"]) ?? 0,
    tous: bigIntToNumber(row?.["tous"]) ?? 0,
    historique: bigIntToNumber(row?.["historique"]) ?? 0,
    rge: 0,
    qualiopi: 0,
    bio: 0,
    epv: 0,
    bni: 0,
    non_identifie_avec_tel: 0,
  };
}

// --- Settings (pipeline_config) ---

export async function getSetting(key: string, tenantId: string | null = null): Promise<string | null> {
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  const row = await prisma.pipelineConfig.findUnique({
    where: { key_tenantId: { key, tenantId: effectiveTid } },
  });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string, tenantId: string | null = null): Promise<void> {
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  await prisma.$executeRaw`
    INSERT INTO pipeline_config (key, tenant_id, value) VALUES (${key}, ${effectiveTid}::uuid, ${value})
    ON CONFLICT(key, tenant_id) DO UPDATE SET value = EXCLUDED.value
  `;
}

export async function getAllSettings(tenantId: string | null = null): Promise<Record<string, string>> {
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  const rows = await prisma.pipelineConfig.findMany({
    where: {
      key: { startsWith: "settings." },
      tenantId: effectiveTid,
    },
  });
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
