import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isStatementTimeout, withSearchTimeout } from "@/lib/search/exec";
import { FIELD_CATALOG } from "@/lib/search/fields";
import { SearchFiltersSchema, buildSearchWhereSql } from "@/lib/search/query";
import { DEFAULT_ENTREPRISES_WHERE, bigIntToNumber } from "@/lib/queries/shared";
import { X402_COMPANY_PUBLIC_FIELD_SET, X402_EXISTS_ONLY_FILTER_FIELDS } from "./public-fields";

const MAX_X402_PAGE_SIZE = 50;

const EstimateRequestSchema = z.object({ filters: SearchFiltersSchema }).strict();

const CompaniesRequestSchema = z
  .object({
    filters: SearchFiltersSchema,
    fields: z.array(z.string().min(1).max(64)).min(1).max(20).optional(),
    sort: z
      .object({
        field: z.string().min(1).max(64),
        dir: z.enum(["asc", "desc"]).optional(),
      })
      .strict()
      .optional(),
    page: z.number().int().min(1).max(500).optional(),
    page_size: z.number().int().min(1).max(MAX_X402_PAGE_SIZE).optional(),
  })
  .strict();

const DEFAULT_FIELDS = [
  "siren",
  "denomination",
  "secteur_final",
  "commune",
  "departement",
  "code_naf",
  "email",
  "email_type",
  "phone",
  "web_domain",
  "prospect_score",
  "tranche_effectifs",
  "bodacc_status",
];

export async function handleX402Estimate(request: NextRequest): Promise<NextResponse> {
  const body = await readJson(request);
  if (!body.ok) return body.response;

  const parsed = EstimateRequestSchema.safeParse(body.value);
  if (!parsed.success) return validationError("Invalid request", parsed.error);

  const filterError = validateX402Filters(parsed.data.filters, "estimate");
  if (filterError) return filterError;

  const { sql: whereSql, params } = buildSearchWhereSql(parsed.data.filters, 1);
  const baseFrom = `FROM entreprises e WHERE ${DEFAULT_ENTREPRISES_WHERE}${whereSql}`;

  try {
    const { agg, breakdown, suppressSmallSegment } = await withSearchTimeout(async (q) => {
      const [agg] = await q<
        { total: bigint; with_phone: bigint; with_email: bigint; with_both: bigint }[]
      >(
        `SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE e.best_phone_e164 IS NOT NULL)::bigint AS with_phone,
                COUNT(*) FILTER (WHERE e.best_email_normalized IS NOT NULL)::bigint AS with_email,
                COUNT(*) FILTER (WHERE e.best_phone_e164 IS NOT NULL AND e.best_email_normalized IS NOT NULL)::bigint AS with_both
         ${baseFrom}`,
        ...params,
      );

      const total = Number(agg.total);
      if (total < 5) return { agg, breakdown: {}, suppressSmallSegment: true };

      let breakdown: Record<string, { key: string; count: number }[]> = {};
      const [bySecteur, byDept, byEcomLevel, byEcomPlatform] = await Promise.all([
        q<{ key: string; count: bigint }[]>(
          `SELECT COALESCE(e.secteur_final,'(inconnu)') AS key, COUNT(*)::bigint AS count
           ${baseFrom} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
          ...params,
        ),
        q<{ key: string; count: bigint }[]>(
          `SELECT COALESCE(e.departement,'(inconnu)') AS key, COUNT(*)::bigint AS count
           ${baseFrom} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
          ...params,
        ),
        q<{ key: string; count: bigint }[]>(
          `SELECT COALESCE(e.ecom_level,'(inconnu)') AS key, COUNT(*)::bigint AS count
           ${baseFrom} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
          ...params,
        ),
        q<{ key: string; count: bigint }[]>(
          `SELECT e.ecom_platform AS key, COUNT(*)::bigint AS count
           ${baseFrom} AND e.ecom_platform IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
          ...params,
        ),
      ]);
      breakdown = {
        by_secteur: bySecteur.map((r) => ({ key: r.key, count: Number(r.count) })),
        by_departement: byDept.map((r) => ({ key: r.key, count: Number(r.count) })),
        by_ecom_level: byEcomLevel.map((r) => ({ key: r.key, count: Number(r.count) })),
        by_ecom_platform: byEcomPlatform.map((r) => ({ key: r.key, count: Number(r.count) })),
      };
      return { agg, breakdown, suppressSmallSegment: false };
    });

    if (suppressSmallSegment) {
      return NextResponse.json({
        estimated_count: null,
        estimated_count_range: "<5",
        actionable: null,
        breakdown: {},
      });
    }

    return NextResponse.json({
      estimated_count: Number(agg.total),
      actionable: {
        with_phone: Number(agg.with_phone),
        with_email: Number(agg.with_email),
        with_phone_and_email: Number(agg.with_both),
      },
      breakdown,
    });
  } catch (err) {
    if (isStatementTimeout(err)) {
      return NextResponse.json(
        { error: "Segment trop coûteux à estimer — affine les filtres (secteur, département)." },
        { status: 400 },
      );
    }
    console.error("[x402/search/estimate] query failed", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function handleX402Companies(request: NextRequest): Promise<NextResponse> {
  const body = await readJson(request);
  if (!body.ok) return body.response;

  const parsed = CompaniesRequestSchema.safeParse(body.value);
  if (!parsed.success) return validationError("Invalid request", parsed.error);

  const requested = parsed.data.fields && parsed.data.fields.length > 0 ? parsed.data.fields : DEFAULT_FIELDS;
  const invalid = requested.filter((field) => !X402_COMPANY_PUBLIC_FIELD_SET.has(field) || !(field in FIELD_CATALOG));
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Unknown fields: ${invalid.join(", ")}` }, { status: 400 });
  }

  const selectExprs = requested.map((field) => `${FIELD_CATALOG[field].sql} AS "${field}"`);

  const filterError = validateX402Filters(parsed.data.filters, "company");
  if (filterError) return filterError;

  let orderBy = "e.denomination ASC NULLS LAST";
  if (parsed.data.sort?.field) {
    const field = parsed.data.sort.field;
    if (!X402_COMPANY_PUBLIC_FIELD_SET.has(field) || !(field in FIELD_CATALOG)) {
      return NextResponse.json({ error: `Unknown sort field: ${field}` }, { status: 400 });
    }
    orderBy = `${FIELD_CATALOG[field].sql} ${parsed.data.sort.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`;
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 25;
  const offset = (page - 1) * pageSize;
  const { sql: whereSql, params, nextIndex } = buildSearchWhereSql(parsed.data.filters, 1);
  const baseFrom = `FROM entreprises e WHERE ${DEFAULT_ENTREPRISES_WHERE}${whereSql}`;

  try {
    const limitIndex = nextIndex;
    const offsetIndex = nextIndex + 1;
    const { rows, count } = await withSearchTimeout(async (q) => {
      const rows = await q<Record<string, unknown>[]>(
        `SELECT ${selectExprs.join(", ")} ${baseFrom} ORDER BY ${orderBy} LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        ...params,
        pageSize,
        offset,
      );
      const [count] = await q<{ c: bigint }[]>(
        `SELECT COUNT(*)::bigint AS c FROM (SELECT 1 ${baseFrom} LIMIT 10001) sub`,
        ...params,
      );
      return { rows, count };
    });

    const rawCount = Number(count.c);
    const total = rawCount > 10000 ? null : rawCount;
    return NextResponse.json({
      total_exact: total,
      total_is_capped: total === null,
      page,
      page_size: pageSize,
      results: rows.map((row) =>
        Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? bigIntToNumber(value) : value])),
      ),
    });
  } catch (err) {
    if (isStatementTimeout(err)) {
      return NextResponse.json(
        { error: "Recherche trop coûteuse — affine les filtres (secteur, département)." },
        { status: 400 },
      );
    }
    console.error("[x402/search/companies] query failed", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

function validateX402Filters(filters: z.infer<typeof SearchFiltersSchema>, endpoint: "estimate" | "company"): NextResponse | null {
  const conditions = [...(filters.all ?? []), ...(filters.any ?? [])];
  const invalidFields = conditions
    .map((condition) => condition.field)
    .filter((field) => !X402_COMPANY_PUBLIC_FIELD_SET.has(field));
  if (invalidFields.length > 0) {
    return NextResponse.json(
      { error: `Unsupported x402 ${endpoint} filter fields: ${[...new Set(invalidFields)].join(", ")}` },
      { status: 400 },
    );
  }

  const invalidContactOps = conditions
    .filter((condition) => X402_EXISTS_ONLY_FILTER_FIELDS.has(condition.field) && condition.op !== "exists")
    .map((condition) => `${condition.field}:${condition.op}`);
  if (invalidContactOps.length > 0) {
    return NextResponse.json(
      { error: `Unsupported x402 contact filter operators: ${[...new Set(invalidContactOps)].join(", ")}` },
      { status: 400 },
    );
  }

  return null;
}

async function readJson(request: NextRequest): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

function validationError(label: string, error: z.ZodError): NextResponse {
  return NextResponse.json(
    { error: label, details: error.issues.map((issue) => issue.message) },
    { status: 400 },
  );
}
