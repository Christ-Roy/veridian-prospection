import { FIELD_CATALOG, type FieldType, type SearchOperator } from "@/lib/search/fields";
import type { Condition, SearchFilters } from "@/lib/search/query";
import { X402_COMPANY_PUBLIC_FIELDS } from "./public-fields";

const DEFAULT_CLICKHOUSE_DATABASE = "odh";
const DEFAULT_CLICKHOUSE_TABLE = "company_search_current";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 10000;
const DEFAULT_MAX_ROWS_TO_READ = 2_000_000;
const MAX_ROWS_TO_READ = 10_000_000;
const DEFAULT_MAX_BYTES_TO_READ = 256 * 1024 * 1024;
const MAX_BYTES_TO_READ = 1024 * 1024 * 1024;
const EXACT_COUNT_CAP = 10_000;
const BREAKDOWN_LIMIT = 8;
const ATTRS = "if(empty(c.attributes_json), '{}', c.attributes_json)";

export interface X402EstimateQueryResult {
  agg: {
    total: number;
    with_phone: number;
    with_email: number;
    with_both: number;
  };
  breakdown: Record<string, { key: string; count: number }[]>;
  suppressSmallSegment: boolean;
}

export interface X402CompaniesQueryInput {
  filters: SearchFilters;
  fields: string[];
  sort?: { field: string; dir?: "asc" | "desc" };
  page: number;
  pageSize: number;
}

export interface X402CompaniesQueryResult {
  rows: Record<string, unknown>[];
  totalExact: number | null;
  totalIsCapped: boolean;
}

interface OdhClickHouseConfig {
  url: string;
  user: string;
  password: string;
  database: string;
  table: string;
  timeoutMs: number;
  maxRowsToRead: number;
  maxBytesToRead: number;
}

interface ClickHouseField {
  expression: string;
  type: FieldType;
  existsExpression: string;
  paramType: "String" | "Float64" | "UInt8";
  condition?: (condition: Condition, params: ClickHouseParams) => string;
}

export class OdhClickHouseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OdhClickHouseConfigError";
  }
}

export class OdhClickHouseQueryError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "limit" | "unavailable" | "invalid_response",
  ) {
    super(message);
    this.name = "OdhClickHouseQueryError";
  }
}

export async function queryX402Estimate(filters: SearchFilters): Promise<X402EstimateQueryResult> {
  const config = getOdhClickHouseConfig();
  const client = new OdhClickHouseClient(config);
  const where = buildClickHouseWhere(filters, config);
  const phoneExists = clickHouseField("phone").existsExpression;
  const emailExists = clickHouseField("email").existsExpression;

  const [agg] = await client.queryJsonEachRow<{
    total: number;
    with_phone: number;
    with_email: number;
    with_both: number;
  }>(
    `SELECT
       count() AS total,
       countIf(${phoneExists}) AS with_phone,
       countIf(${emailExists}) AS with_email,
       countIf(${phoneExists} AND ${emailExists}) AS with_both
     ${where.sql}
     FORMAT JSONEachRow`,
    where.params,
  );

  const safeAgg = {
    total: Number(agg?.total ?? 0),
    with_phone: Number(agg?.with_phone ?? 0),
    with_email: Number(agg?.with_email ?? 0),
    with_both: Number(agg?.with_both ?? 0),
  };
  if (safeAgg.total < 5) return { agg: safeAgg, breakdown: {}, suppressSmallSegment: true };

  const [bySecteur, byDept, byEcomLevel, byEcomPlatform] = await Promise.all([
    queryBreakdown(client, where, "secteur_final", false),
    queryBreakdown(client, where, "departement", false),
    queryBreakdown(client, where, "ecom_level", false),
    queryBreakdown(client, where, "ecom_platform", true),
  ]);

  return {
    agg: safeAgg,
    breakdown: {
      by_secteur: bySecteur,
      by_departement: byDept,
      by_ecom_level: byEcomLevel,
      by_ecom_platform: byEcomPlatform,
    },
    suppressSmallSegment: false,
  };
}

export async function queryX402Companies(input: X402CompaniesQueryInput): Promise<X402CompaniesQueryResult> {
  const config = getOdhClickHouseConfig();
  const client = new OdhClickHouseClient(config);
  const where = buildClickHouseWhere(input.filters, config);
  const params = where.params.clone();
  const limit = params.add(input.pageSize, "UInt64");
  const offset = params.add((input.page - 1) * input.pageSize, "UInt64");
  const selectExprs = input.fields.map((field) => `${clickHouseField(field).expression} AS ${quoteIdentifier(field)}`);
  const sortField = input.sort?.field ? clickHouseField(input.sort.field) : clickHouseField("denomination");
  const sortDir = input.sort?.dir === "desc" ? "DESC" : "ASC";

  const rows = await client.queryJsonEachRow<Record<string, unknown>>(
    `SELECT ${selectExprs.join(", ")}
     ${where.sql}
     ORDER BY ${sortField.expression} ${sortDir}, c.siren ASC
     LIMIT ${limit} OFFSET ${offset}
     FORMAT JSONEachRow`,
    params,
  );

  const [count] = await client.queryJsonEachRow<{ c: number }>(
    `SELECT count() AS c
     FROM (SELECT 1 ${where.sql} LIMIT ${EXACT_COUNT_CAP + 1})
     FORMAT JSONEachRow`,
    where.params,
  );
  const rawCount = Number(count?.c ?? 0);

  return {
    rows,
    totalExact: rawCount > EXACT_COUNT_CAP ? null : rawCount,
    totalIsCapped: rawCount > EXACT_COUNT_CAP,
  };
}

export function getOdhClickHouseConfig(env: NodeJS.ProcessEnv = process.env): OdhClickHouseConfig {
  const url = env.ODH_CLICKHOUSE_URL?.trim();
  if (!url) throw new OdhClickHouseConfigError("ODH_CLICKHOUSE_URL is required when x402 ODH is enabled");
  if (!/^https?:\/\//.test(url)) throw new OdhClickHouseConfigError("ODH_CLICKHOUSE_URL must be an HTTP(S) URL");

  const password = env.ODH_CLICKHOUSE_PASSWORD;
  if (!password) throw new OdhClickHouseConfigError("ODH_CLICKHOUSE_PASSWORD is required when x402 ODH is enabled");

  return {
    url,
    user: env.ODH_CLICKHOUSE_USER?.trim() || "odh",
    password,
    database: cleanIdentifier(env.ODH_CLICKHOUSE_DATABASE || DEFAULT_CLICKHOUSE_DATABASE, "ODH_CLICKHOUSE_DATABASE"),
    table: cleanIdentifier(env.ODH_CLICKHOUSE_SEARCH_TABLE || DEFAULT_CLICKHOUSE_TABLE, "ODH_CLICKHOUSE_SEARCH_TABLE"),
    timeoutMs: boundedInt(env.ODH_CLICKHOUSE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS, "ODH_CLICKHOUSE_TIMEOUT_MS"),
    maxRowsToRead: boundedInt(
      env.ODH_CLICKHOUSE_MAX_ROWS_TO_READ,
      DEFAULT_MAX_ROWS_TO_READ,
      1,
      MAX_ROWS_TO_READ,
      "ODH_CLICKHOUSE_MAX_ROWS_TO_READ",
    ),
    maxBytesToRead: boundedInt(
      env.ODH_CLICKHOUSE_MAX_BYTES_TO_READ,
      DEFAULT_MAX_BYTES_TO_READ,
      1,
      MAX_BYTES_TO_READ,
      "ODH_CLICKHOUSE_MAX_BYTES_TO_READ",
    ),
  };
}

export function buildClickHouseWhere(
  filters: SearchFilters,
  config: Pick<OdhClickHouseConfig, "database" | "table"> = getOdhClickHouseConfig(),
): { sql: string; params: ClickHouseParams } {
  const params = new ClickHouseParams();
  const groups: string[] = [defaultPublicCompanyPredicate()];

  if (filters.all && filters.all.length > 0) {
    groups.push(`(${filters.all.map((condition) => conditionToClickHouseSql(condition, params)).join(" AND ")})`);
  }

  if (filters.any && filters.any.length > 0) {
    groups.push(`(${filters.any.map((condition) => conditionToClickHouseSql(condition, params)).join(" OR ")})`);
  }

  return {
    sql: `FROM ${quoteIdentifier(config.database)}.${quoteIdentifier(config.table)} c WHERE ${groups.join(" AND ")}`,
    params,
  };
}

async function queryBreakdown(
  client: OdhClickHouseClient,
  where: { sql: string; params: ClickHouseParams },
  field: string,
  requireValue: boolean,
): Promise<{ key: string; count: number }[]> {
  const definition = clickHouseField(field);
  const valuePredicate = requireValue ? ` AND ${definition.existsExpression}` : "";
  const rows = await client.queryJsonEachRow<{ key: string; count: number }>(
    `SELECT if(${definition.existsExpression}, toString(${definition.expression}), '(inconnu)') AS key,
            count() AS count
     ${where.sql}${valuePredicate}
     GROUP BY key
     ORDER BY count DESC
     LIMIT ${BREAKDOWN_LIMIT}
     FORMAT JSONEachRow`,
    where.params,
  );
  return rows.map((row) => ({ key: String(row.key), count: Number(row.count) }));
}

class OdhClickHouseClient {
  constructor(private readonly config: OdhClickHouseConfig) {}

  async queryJsonEachRow<T>(sql: string, params: ClickHouseParams = new ClickHouseParams()): Promise<T[]> {
    const url = new URL(this.config.url);
    url.searchParams.set("readonly", "1");
    url.searchParams.set("max_execution_time", String(Math.ceil(this.config.timeoutMs / 1000)));
    url.searchParams.set("max_threads", "2");
    url.searchParams.set("max_result_rows", "2000");
    url.searchParams.set("result_overflow_mode", "throw");
    url.searchParams.set("max_rows_to_read", String(this.config.maxRowsToRead));
    url.searchParams.set("max_bytes_to_read", String(this.config.maxBytesToRead));
    url.searchParams.set("read_overflow_mode", "throw");
    params.applyTo(url.searchParams);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs + 1000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.user}:${this.config.password}`).toString("base64")}`,
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: sql,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new OdhClickHouseQueryError("ClickHouse query timed out", "timeout");
      }
      throw new OdhClickHouseQueryError("ClickHouse is unavailable", "unavailable");
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new OdhClickHouseQueryError("ClickHouse rejected the query", classifyClickHouseFailure(text));
    }

    try {
      return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T);
    } catch (error) {
      throw new OdhClickHouseQueryError("ClickHouse returned invalid JSONEachRow", "invalid_response");
    }
  }
}

export class ClickHouseParams {
  private next = 1;
  private readonly values: { name: string; value: string }[] = [];

  add(value: unknown, type: "String" | "Float64" | "UInt8" | "UInt64"): string {
    const name = `p${this.next++}`;
    this.values.push({ name, value: stringifyParam(value, type) });
    return `{${name}:${type}}`;
  }

  clone(): ClickHouseParams {
    const copy = new ClickHouseParams();
    copy.next = this.next;
    copy.values.push(...this.values);
    return copy;
  }

  applyTo(searchParams: URLSearchParams): void {
    for (const param of this.values) searchParams.set(`param_${param.name}`, param.value);
  }
}

function conditionToClickHouseSql(condition: Condition, params: ClickHouseParams): string {
  const field = clickHouseField(condition.field);
  if (field.condition) return field.condition(condition, params);

  switch (condition.op) {
    case "exists":
      return condition.value === true ? field.existsExpression : `NOT (${field.existsExpression})`;
    case "between": {
      const min = params.add(condition.min, field.paramType);
      const max = params.add(condition.max, field.paramType);
      return `(${field.expression} BETWEEN ${min} AND ${max})`;
    }
    case "in": {
      const placeholders = (condition.values ?? []).map((value) => params.add(value, field.paramType));
      return `${field.expression} IN (${placeholders.join(",")})`;
    }
    case "contains": {
      const needle = params.add(condition.value, "String");
      return `positionCaseInsensitive(toString(${field.expression}), ${needle}) > 0`;
    }
    default: {
      const operator = clickHouseOperator(condition.op);
      const value = params.add(condition.value, field.paramType);
      return `${field.expression} ${operator} ${value}`;
    }
  }
}

function arrayStringCondition(arrayExpression: string, selectExpression: string): ClickHouseField["condition"] {
  return (condition, params) => {
    switch (condition.op) {
      case "exists":
        return condition.value === true ? `notEmpty(${arrayExpression})` : `empty(${arrayExpression})`;
      case "eq": {
        const value = params.add(condition.value, "String");
        return `has(${arrayExpression}, ${value})`;
      }
      case "neq": {
        const value = params.add(condition.value, "String");
        return `not has(${arrayExpression}, ${value})`;
      }
      case "in": {
        const parts = (condition.values ?? []).map((value) => `has(${arrayExpression}, ${params.add(value, "String")})`);
        return `(${parts.join(" OR ")})`;
      }
      case "contains": {
        const needle = params.add(condition.value, "String");
        return `arrayExists(item -> positionCaseInsensitive(item, ${needle}) > 0, ${arrayExpression})`;
      }
      default: {
        const operator = clickHouseOperator(condition.op);
        const value = params.add(condition.value, "String");
        return `${selectExpression} ${operator} ${value}`;
      }
    }
  };
}

function clickHouseField(field: string): ClickHouseField {
  const definition = CLICKHOUSE_X402_FIELDS[field];
  if (!definition) throw new OdhClickHouseConfigError(`Unsupported x402 ClickHouse field: ${field}`);
  return definition;
}

function defaultPublicCompanyPredicate(): string {
  return [
    "notEmpty(c.siren)",
    "(NOT JSONHas(" + ATTRS + ", 'is_registrar') OR JSONExtractBool(" + ATTRS + ", 'is_registrar') = 0)",
    "(NOT JSONHas(" + ATTRS + ", 'ca_suspect') OR JSONExtractBool(" + ATTRS + ", 'ca_suspect') = 0)",
  ].join(" AND ");
}

function classifyClickHouseFailure(message: string): OdhClickHouseQueryError["kind"] {
  if (/TIMEOUT_EXCEEDED|timeout|aborted/i.test(message)) return "timeout";
  if (/TOO_MANY_ROWS|TOO_MANY_BYTES|MEMORY_LIMIT_EXCEEDED|Limit/i.test(message)) return "limit";
  return "unavailable";
}

function clickHouseOperator(operator: SearchOperator): string {
  const operators: Partial<Record<SearchOperator, string>> = {
    eq: "=",
    neq: "!=",
    gte: ">=",
    lte: "<=",
    gt: ">",
    lt: "<",
  };
  return operators[operator] ?? "=";
}

function cleanIdentifier(value: string, envName: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new OdhClickHouseConfigError(`${envName} must be a simple ClickHouse identifier`);
  }
  return trimmed;
}

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number, envName: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new OdhClickHouseConfigError(`${envName} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function stringifyParam(value: unknown, type: "String" | "Float64" | "UInt8" | "UInt64"): string {
  if (type === "UInt8") return value === true || value === 1 ? "1" : "0";
  if (type === "Float64" || type === "UInt64") return String(value);
  return String(value ?? "");
}

function jsonStringField(name: string, type: FieldType): ClickHouseField {
  const expression = `JSONExtractString(${ATTRS}, '${name}')`;
  return {
    expression,
    type,
    existsExpression: `(JSONHas(${ATTRS}, '${name}') AND notEmpty(${expression}))`,
    paramType: "String",
  };
}

function jsonNumberField(name: string): ClickHouseField {
  const expression = `if(JSONHas(${ATTRS}, '${name}'), toNullable(JSONExtractFloat(${ATTRS}, '${name}')), NULL)`;
  return {
    expression,
    type: "number",
    existsExpression: `isNotNull(${expression})`,
    paramType: "Float64",
  };
}

function jsonBooleanField(name: string): ClickHouseField {
  const expression = `if(JSONHas(${ATTRS}, '${name}'), toNullable(toUInt8(JSONExtractBool(${ATTRS}, '${name}'))), NULL)`;
  return {
    expression,
    type: "boolean",
    existsExpression: `isNotNull(${expression})`,
    paramType: "UInt8",
  };
}

function jsonDateField(name: string): ClickHouseField {
  const raw = `JSONExtractString(${ATTRS}, '${name}')`;
  return {
    expression: raw,
    type: "date",
    existsExpression: `(JSONHas(${ATTRS}, '${name}') AND notEmpty(${raw}))`,
    paramType: "String",
  };
}

function fieldFromCatalog(name: string): ClickHouseField {
  const definition = FIELD_CATALOG[name];
  if (!definition) throw new OdhClickHouseConfigError(`Missing field catalog entry for ${name}`);
  if (definition.type === "number") return jsonNumberField(name);
  if (definition.type === "boolean") return jsonBooleanField(name);
  if (definition.type === "date") return jsonDateField(name);
  return jsonStringField(name, definition.type);
}

const CLICKHOUSE_X402_FIELDS: Record<string, ClickHouseField> = Object.fromEntries(
  X402_COMPANY_PUBLIC_FIELDS.map((name) => [name, fieldFromCatalog(name)]),
);

CLICKHOUSE_X402_FIELDS.siren = {
  expression: "c.siren",
  type: "text",
  existsExpression: "notEmpty(c.siren)",
  paramType: "String",
};
CLICKHOUSE_X402_FIELDS.denomination = {
  expression: "c.legal_name",
  type: "text",
  existsExpression: "notEmpty(c.legal_name)",
  paramType: "String",
};
CLICKHOUSE_X402_FIELDS.code_naf = {
  expression: "c.naf_code",
  type: "text",
  existsExpression: "notEmpty(c.naf_code)",
  paramType: "String",
};
CLICKHOUSE_X402_FIELDS.email = {
  expression: "arrayElement(c.emails, 1)",
  type: "text",
  existsExpression: "notEmpty(c.emails)",
  paramType: "String",
  condition: arrayStringCondition("c.emails", "arrayElement(c.emails, 1)"),
};
CLICKHOUSE_X402_FIELDS.web_domain = {
  expression: "arrayElement(c.domains, 1)",
  type: "text",
  existsExpression: "notEmpty(c.domains)",
  paramType: "String",
  condition: arrayStringCondition("c.domains", "arrayElement(c.domains, 1)"),
};
CLICKHOUSE_X402_FIELDS.code_postal = {
  expression: "arrayElement(c.postal_codes, 1)",
  type: "text",
  existsExpression: "notEmpty(c.postal_codes)",
  paramType: "String",
  condition: arrayStringCondition("c.postal_codes", "arrayElement(c.postal_codes, 1)"),
};
CLICKHOUSE_X402_FIELDS.departement = {
  expression: `if(notEmpty(JSONExtractString(${ATTRS}, 'departement')), JSONExtractString(${ATTRS}, 'departement'), substring(arrayElement(c.postal_codes, 1), 1, 2))`,
  type: "text",
  existsExpression: `(notEmpty(JSONExtractString(${ATTRS}, 'departement')) OR notEmpty(c.postal_codes))`,
  paramType: "String",
};
