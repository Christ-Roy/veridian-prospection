// Segments queries — SIREN-centric (2026-04-05 refactor)
//
// This file replaced the 1007-line legacy implementation that was tightly coupled
// to the `results` table with its 219 columns (lead_flags, cnb_*, pj_leads, etc.).
//
// New model: segments are backed by PG VIEWs registered in `segment_catalog`:
//   - v_s01_rge_sans_site, v_s10_horeca_sans_site, v_s27_multi_signaux, etc.
//   - v_top_diamond (score ≥80), v_top_gold (score ≥60)
//
// Each VIEW returns `entreprises` rows that match a business rule. Pagination,
// sorting and extra filters (seen/claude/appele) are applied on top.
//
// Legacy segment IDs (poubelle, tpe, pme, grosse, coldcall, claude, pj, 69/eclates)
// are mapped to the closest new VIEW, or fall back to an empty result.

import { prisma, bigIntToNumber, tenantWhere, DEFAULT_ENTREPRISES_WHERE } from "./shared";

const VIEW_NAME_RE = /^v_[a-z0-9_]+$/;

type SegmentParams = {
  page: number;
  pageSize: number;
  sort?: string;
  sortDir?: "asc" | "desc";
  seen?: "seen" | "unseen";
  claude?: "analyzed" | "not_analyzed";
  honeypot?: "safe" | "suspect";
  appele?: "appele" | "non_appele";
};

// Map legacy segment IDs to the new VIEW-based equivalents.
// Unknown IDs fall through to a generic lookup in segment_catalog.
const LEGACY_SEGMENT_MAP: Record<string, string> = {
  "topleads": "v_top_diamond",
  "topleads/diamond": "v_top_diamond",
  "topleads/gold": "v_top_gold",
  "coldcall": "v_s27_multi_signaux",
  "rge": "v_s23_gold_rge",
  "rge/sans_site": "v_s01_rge_sans_site",
  "rge/double_certif": "v_s09_double_certif_rge_qualiopi",
  "claude": "v_s27_multi_signaux", // placeholder until we have a "prospects analysed" view
};

async function resolveViewName(segmentId: string): Promise<{ viewName: string; description: string } | null> {
  // First check legacy aliases
  const mapped = LEGACY_SEGMENT_MAP[segmentId];
  if (mapped) {
    return { viewName: mapped, description: segmentId };
  }

  // Look up in segment_catalog (segments created by the data hub)
  const rows = await prisma.$queryRaw<{ view_name: string; description: string }[]>`
    SELECT view_name, description FROM segment_catalog WHERE segment_id = ${segmentId} LIMIT 1
  `;
  if (rows[0]) return { viewName: rows[0].view_name, description: rows[0].description };

  // Check if segmentId itself is a valid view name (e.g. "v_s01_rge_sans_site")
  if (VIEW_NAME_RE.test(segmentId)) {
    return { viewName: segmentId, description: segmentId };
  }

  return null;
}

const SEGMENT_SELECT_COLUMNS = `
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
  COALESCE(e.web_tech_score, 0) as tech_score,
  COALESCE(e.web_eclate_score, 0) as eclate_score,
  e.prospect_score,
  e.secteur_final,
  e.domaine_final,
  e.is_auto_entrepreneur
`;

function outreachJoinSql(tenantId: string | null): string {
  return tenantId !== null
    ? `LEFT JOIN outreach o ON o.siren = e.siren AND (o.tenant_id = '${tenantId}' OR o.tenant_id IS NULL)`
    : `LEFT JOIN outreach o ON o.siren = e.siren AND o.tenant_id IS NULL`;
}

function claudeExistsSql(tenantId: string | null): string {
  const tw = tenantWhere("ca", tenantId);
  return `EXISTS (SELECT 1 FROM claude_activity ca WHERE ca.siren = e.siren AND ${tw})`;
}

function claudeNotExistsSql(tenantId: string | null): string {
  const tw = tenantWhere("ca", tenantId);
  return `NOT EXISTS (SELECT 1 FROM claude_activity ca WHERE ca.siren = e.siren AND ${tw})`;
}

const SORT_COLS: Record<string, string> = {
  siren: "e.siren",
  nom_entreprise: "e.denomination",
  ville: "e.commune",
  effectifs: "e.tranche_effectifs",
  ca: "e.chiffre_affaires",
  tech_score: "e.web_tech_score",
  eclate_score: "e.web_eclate_score",
  copyright_year: "e.web_copyright_year",
  prospect_score: "e.prospect_score",
  outreach_status: "COALESCE(o.status, 'a_contacter')",
  contacted_date: "o.contacted_date",
  last_visited: "o.last_visited",
};

/**
 * Main segment query. Reads rows from a VIEW (v_s01_*, v_top_*, etc.).
 *
 * The VIEW is treated as the FROM clause alias `e` (it returns entreprises rows).
 * We wrap it in a subquery so that downstream joins (outreach, claude_activity) work.
 */
async function getLeadsFromView(
  viewName: string,
  params: SegmentParams,
  tenantId: string | null,
): Promise<{ data: Record<string, unknown>[]; total: number; page: number; pageSize: number; totalPages: number; claudeAnalyzed: number }> {
  if (!VIEW_NAME_RE.test(viewName)) {
    return { data: [], total: 0, page: 1, pageSize: 50, totalPages: 1, claudeAnalyzed: 0 };
  }

  const { page, pageSize, sort = "prospect_score", sortDir = "desc", seen, claude } = params;
  const sortCol = SORT_COLS[sort] ?? "e.prospect_score";
  const dir = sortDir === "desc" ? "DESC NULLS LAST" : "ASC NULLS LAST";

  const oJoin = outreachJoinSql(tenantId);

  const extraClauses: string[] = [];
  if (seen === "seen") extraClauses.push("o.last_visited IS NOT NULL");
  if (seen === "unseen") extraClauses.push("o.last_visited IS NULL");
  if (claude === "analyzed") extraClauses.push(claudeExistsSql(tenantId));
  if (claude === "not_analyzed") extraClauses.push(claudeNotExistsSql(tenantId));

  const whereExtra = extraClauses.length > 0 ? ` WHERE ${extraClauses.join(" AND ")}` : "";

  // Wrap the view as alias `e` so the outreach join works the same way
  const fromClause = `FROM ${viewName} e ${oJoin}${whereExtra}`;

  const countSql = `SELECT COUNT(*) as count ${fromClause}`;
  const totalResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(countSql);
  const total = bigIntToNumber(totalResult[0].count);

  const offset = (page - 1) * pageSize;
  const dataSql = `
    SELECT ${SEGMENT_SELECT_COLUMNS}
    ${fromClause}
    ORDER BY ${sortCol} ${dir}, e.siren ASC
    LIMIT $1 OFFSET $2
  `;
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(dataSql, pageSize, offset);

  // Claude analyzed count for this segment
  const twCa = tenantWhere("ca", tenantId);
  const claudeCountResult = await prisma.$queryRawUnsafe<[{ c: bigint }]>(
    `SELECT COUNT(DISTINCT e.siren) as c
     FROM ${viewName} e
     WHERE EXISTS (SELECT 1 FROM claude_activity ca WHERE ca.siren = e.siren AND ${twCa})`,
  );
  const claudeAnalyzed = bigIntToNumber(claudeCountResult[0].c);

  return {
    data: normalizeSegmentRows(rows),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    claudeAnalyzed,
  };
}

/**
 * Manual segments: rows added via "Add to segment" UI.
 * Stored in the `lead_segments` table (siren + segment + tenant_id).
 */
export async function getManualSegmentLeads(segmentId: string, params: SegmentParams, tenantId: string | null = null) {
  const { page, pageSize, sort = "nom_entreprise", sortDir = "asc", seen, claude } = params;
  const sortCol = SORT_COLS[sort] ?? "ls.added_at";
  const dir = sortDir === "desc" ? "DESC" : "ASC";
  const oJoin = outreachJoinSql(tenantId);
  const twLs = tenantWhere("ls", tenantId);

  const extraClauses: string[] = [];
  if (seen === "seen") extraClauses.push("o.last_visited IS NOT NULL");
  if (seen === "unseen") extraClauses.push("o.last_visited IS NULL");
  if (claude === "analyzed") extraClauses.push(claudeExistsSql(tenantId));
  if (claude === "not_analyzed") extraClauses.push(claudeNotExistsSql(tenantId));
  const whereExtra = extraClauses.length > 0 ? ` AND ${extraClauses.join(" AND ")}` : "";

  const totalResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
    `SELECT COUNT(*) as count
     FROM lead_segments ls
     JOIN entreprises e ON e.siren = ls.siren
     ${oJoin}
     WHERE ls.segment = $1 AND ${twLs} AND ${DEFAULT_ENTREPRISES_WHERE}${whereExtra}`,
    segmentId,
  );
  const total = bigIntToNumber(totalResult[0].count);

  const offset = (page - 1) * pageSize;
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${SEGMENT_SELECT_COLUMNS},
      ls.added_at as segment_added_at,
      ls.notes as segment_notes
    FROM lead_segments ls
    JOIN entreprises e ON e.siren = ls.siren
    ${oJoin}
    WHERE ls.segment = $1 AND ${twLs} AND ${DEFAULT_ENTREPRISES_WHERE}${whereExtra}
    ORDER BY ${sortCol} ${dir}, e.siren ASC
    LIMIT $2 OFFSET $3`,
    segmentId,
    pageSize,
    offset,
  );

  return {
    data: normalizeSegmentRows(rows),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    claudeAnalyzed: 0,
  };
}

/**
 * Smart segments — kept for backward compat. Now resolved via segment_catalog VIEWs.
 */
export async function getSmartSegmentLeads(segmentId: string, params: SegmentParams, tenantId: string | null = null) {
  const resolved = await resolveViewName(segmentId);
  if (!resolved) {
    return { data: [], total: 0, page: 1, pageSize: 50, totalPages: 1, claudeAnalyzed: 0 };
  }
  return getLeadsFromView(resolved.viewName, params, tenantId);
}

/**
 * PJ segments — deprecated. pj_leads table is no longer in the schema.
 */
export async function getPjSegmentLeads(_segmentId: string, params: SegmentParams, _tenantIdUnused: string | null = null) {
  void _tenantIdUnused;
  return {
    data: [],
    total: 0,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: 1,
  };
}

/**
 * Main dispatcher — routes by segment type.
 */
export async function getSegmentLeads(segmentId: string, params: SegmentParams, tenantId: string | null = null) {
  // Try VIEW-based resolution first (S01, S10, topleads, rge/*, coldcall)
  const resolved = await resolveViewName(segmentId);
  if (resolved) {
    return getLeadsFromView(resolved.viewName, params, tenantId);
  }
  // Fall back to manual segments (lead_segments table)
  return getManualSegmentLeads(segmentId, params, tenantId);
}

/**
 * Count for a single segment.
 */
export async function getSegmentCount(segmentId: string, tenantId: string | null = null): Promise<number> {
  const resolved = await resolveViewName(segmentId);
  if (resolved) {
    const rows = await prisma.$queryRawUnsafe<[{ c: bigint }]>(
      `SELECT COUNT(*) as c FROM ${resolved.viewName}`,
    );
    return bigIntToNumber(rows[0].c);
  }
  // Manual segment
  const twLs = tenantWhere("lead_segments", tenantId);
  const result = await prisma.$queryRawUnsafe<[{ c: bigint }]>(
    `SELECT COUNT(*) as c FROM lead_segments WHERE segment = $1 AND ${twLs}`,
    segmentId,
  );
  return bigIntToNumber(result[0].c);
}

/**
 * Batched count for all segments in the catalog.
 * Returns a map of segment_id → volume.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getAllSegmentCounts(_tenantId: string | null = null): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<{ segment_id: string; volume: number | null }[]>`
    SELECT segment_id, volume FROM segment_catalog ORDER BY volume DESC NULLS LAST
  `;
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.segment_id] = Number(row.volume ?? 0);
  }
  return counts;
}

/**
 * Add SIREN(s) to a manual segment.
 * (Legacy alias: `addToSegment` — kept for UI backward compat even though the arg list now contains SIREN values.)
 */
export async function addToSegment(sirens: string[], segment: string, tenantId: string | null = null) {
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const tid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  let added = 0;
  await prisma.$transaction(async (tx) => {
    for (const siren of sirens) {
      try {
        await tx.$executeRaw`
          INSERT INTO lead_segments (siren, segment, tenant_id, added_at)
          VALUES (${siren}, ${segment}, ${tid}::uuid, ${now})
          ON CONFLICT DO NOTHING
        `;
        added++;
      } catch {
        // Ignore conflicts
      }
    }
  });
  return added;
}

/**
 * Remove SIREN(s) from a manual segment.
 */
export async function removeFromSegment(sirens: string[], segment: string, tenantId: string | null = null) {
  const tw = tenantWhere("lead_segments", tenantId);
  if (sirens.length === 0) return 0;
  const placeholders = sirens.map((_, i) => `$${i + 2}`).join(",");
  const result = await prisma.$executeRawUnsafe(
    `DELETE FROM lead_segments WHERE segment = $1 AND siren IN (${placeholders}) AND ${tw}`,
    segment,
    ...sirens,
  );
  return result;
}

/** Normalize bigint fields in segment rows */
function normalizeSegmentRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(r => {
    const out = { ...r } as Record<string, unknown>;
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === "bigint") out[k] = Number(v);
    }
    return out;
  });
}
