import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { FIELD_CATALOG } from "@/lib/search/fields";
import { SearchFiltersSchema } from "@/lib/search/query";
import {
  OdhClickHouseConfigError,
  OdhClickHouseQueryError,
  queryX402Companies,
  queryX402Estimate,
} from "./clickhouse";
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

  try {
    const { agg, breakdown, suppressSmallSegment } = await queryX402Estimate(parsed.data.filters);

    if (suppressSmallSegment) {
      return NextResponse.json({
        estimated_count: null,
        estimated_count_range: "<5",
        actionable: null,
        breakdown: {},
      });
    }

    return NextResponse.json({
      estimated_count: agg.total,
      actionable: {
        with_phone: agg.with_phone,
        with_email: agg.with_email,
        with_phone_and_email: agg.with_both,
      },
      breakdown,
    });
  } catch (err) {
    const failure = clickHouseFailureResponse(err, "estimate");
    if (failure) return failure;
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

  const filterError = validateX402Filters(parsed.data.filters, "company");
  if (filterError) return filterError;

  let orderBy: "asc" | "desc" = "asc";
  if (parsed.data.sort?.field) {
    const field = parsed.data.sort.field;
    if (!X402_COMPANY_PUBLIC_FIELD_SET.has(field) || !(field in FIELD_CATALOG)) {
      return NextResponse.json({ error: `Unknown sort field: ${field}` }, { status: 400 });
    }
    orderBy = parsed.data.sort.dir === "asc" ? "asc" : "desc";
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 25;

  try {
    const result = await queryX402Companies({
      filters: parsed.data.filters,
      fields: requested,
      sort: parsed.data.sort?.field ? { field: parsed.data.sort.field, dir: orderBy } : undefined,
      page,
      pageSize,
    });

    return NextResponse.json({
      total_exact: result.totalExact,
      total_is_capped: result.totalIsCapped,
      page,
      page_size: pageSize,
      results: result.rows,
    });
  } catch (err) {
    const failure = clickHouseFailureResponse(err, "companies");
    if (failure) return failure;
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

function clickHouseFailureResponse(error: unknown, endpoint: "estimate" | "companies"): NextResponse | null {
  if (error instanceof OdhClickHouseConfigError) {
    return NextResponse.json(
      {
        error: "odh_clickhouse_not_configured",
        detail: "ODH ClickHouse must be configured; PostgreSQL fallback is disabled for paid x402 reads.",
      },
      { status: 503 },
    );
  }

  if (error instanceof OdhClickHouseQueryError) {
    if (error.kind === "timeout" || error.kind === "limit") {
      return NextResponse.json(
        {
          error:
            endpoint === "estimate"
              ? "Segment trop coûteux à estimer — affine les filtres (secteur, département)."
              : "Recherche trop coûteuse — affine les filtres (secteur, département).",
          source: "odh_clickhouse",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "odh_clickhouse_unavailable",
        detail: "Paid x402 reads fail closed instead of falling back to PostgreSQL.",
      },
      { status: 503 },
    );
  }

  return null;
}
