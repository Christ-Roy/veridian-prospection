/**
 * POST /api/search/companies — recherche paginée d'entreprises (cœur du moteur IA).
 *
 * L'IA envoie un JSON de filtres + une projection de champs, reçoit une page de
 * résultats. Référentiel PARTAGÉ (entreprises n'a pas de tenant_id) — lecture seule.
 *
 * Auth : bearer machine (SEARCH_API_SECRET).
 * Body : {
 *   filters: SearchFilters,
 *   fields?: string[],     // projection (whitelist) ; défaut = jeu cold-outreach
 *   sort?:  { field, dir },
 *   page?: number, page_size?: number   // page_size borné à 200
 * }
 */
import { NextResponse } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";
import { authenticateSearch } from "@/lib/search/auth";
import { SearchFiltersSchema, buildSearchWhereSql } from "@/lib/search/query";
import { withSearchTimeout, isStatementTimeout } from "@/lib/search/exec";
import { FIELD_CATALOG } from "@/lib/search/fields";
import { DEFAULT_ENTREPRISES_WHERE, bigIntToNumber } from "@/lib/queries/shared";

export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 200;

// Champs par défaut renvoyés si le caller ne précise pas `fields` — le strict
// nécessaire au cold call / emailing.
const DEFAULT_FIELDS = [
  "siren", "denomination", "secteur_final", "commune", "departement",
  "chiffre_affaires", "phone", "email", "web_domain", "prospect_score",
];

export async function POST(req: Request) {
  const auth = authenticateSearch(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (isRateLimited(`search-companies:${auth.tenantId}`, 60, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: {
    filters?: unknown;
    fields?: unknown;
    sort?: { field?: string; dir?: string };
    page?: number;
    page_size?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ─── Filtres ───
  const parsed = SearchFiltersSchema.safeParse(body?.filters);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid filters", details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  // ─── Projection (whitelist) ───
  const requested = Array.isArray(body?.fields) && body.fields.length > 0
    ? (body.fields as unknown[]).filter((f): f is string => typeof f === "string")
    : DEFAULT_FIELDS;
  const invalid = requested.filter((f) => !(f in FIELD_CATALOG) && f !== "siren");
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Unknown fields: ${invalid.join(", ")}` }, { status: 400 });
  }
  // Construit le SELECT : "expr AS alias" pour chaque champ projeté.
  const selectExprs = requested.map((f) => `${FIELD_CATALOG[f].sql} AS "${f}"`);

  // ─── Tri (whitelist) ───
  let orderBy = "e.prospect_score DESC NULLS LAST";
  if (body?.sort?.field) {
    const sf = body.sort.field;
    if (!(sf in FIELD_CATALOG)) {
      return NextResponse.json({ error: `Unknown sort field: ${sf}` }, { status: 400 });
    }
    const dir = body.sort.dir === "asc" ? "ASC" : "DESC";
    orderBy = `${FIELD_CATALOG[sf].sql} ${dir} NULLS LAST`;
  }

  // ─── Pagination ───
  const page = Math.max(1, Math.floor(Number(body?.page) || 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(body?.page_size) || 50)));
  const offset = (page - 1) * pageSize;

  const { sql: whereSql, params, nextIndex } = buildSearchWhereSql(parsed.data, 1);
  const baseFrom = `FROM entreprises e WHERE ${DEFAULT_ENTREPRISES_WHERE}${whereSql}`;

  try {
    const limIdx = nextIndex;
    const offIdx = nextIndex + 1;
    const { rows, cnt } = await withSearchTimeout(async (q) => {
      const rows = await q<Record<string, unknown>[]>(
        `SELECT ${selectExprs.join(", ")} ${baseFrom} ORDER BY ${orderBy} LIMIT $${limIdx} OFFSET $${offIdx}`,
        ...params, pageSize, offset,
      );
      // COUNT plafonné : exact jusqu'à 10000, sinon "10000+" (évite un COUNT lent
      // sur un segment énorme — l'IA affine via /estimate si besoin du chiffre exact).
      const [cnt] = await q<{ c: bigint }[]>(
        `SELECT COUNT(*)::bigint AS c FROM (SELECT 1 ${baseFrom} LIMIT 10001) sub`,
        ...params,
      );
      return { rows, cnt };
    });
    const rawCount = Number(cnt.c);
    const total = rawCount > 10000 ? null : rawCount;

    // Normalise les BigInt (chiffre_affaires etc.) en number pour le JSON.
    const results = rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        out[k] = typeof v === "bigint" ? bigIntToNumber(v) : v;
      }
      return out;
    });

    return NextResponse.json({
      total_exact: total,            // null = "plus de 10000"
      total_is_capped: total === null,
      page, page_size: pageSize,
      results,
    });
  } catch (err) {
    if (isStatementTimeout(err)) {
      return NextResponse.json(
        { error: "Recherche trop coûteuse — affine les filtres (secteur, département)." },
        { status: 400 },
      );
    }
    console.error("[search/companies] query failed", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
