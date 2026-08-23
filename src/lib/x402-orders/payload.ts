import { z } from "zod";
import { FIELD_CATALOG } from "@/lib/search/fields";
import { SearchFiltersSchema } from "@/lib/search/query";

export const X402_JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "expired",
] as const;

export const MAX_X402_JOB_EXPIRES_SECONDS = 24 * 60 * 60;
export const DEFAULT_X402_JOB_EXPIRES_SECONDS = MAX_X402_JOB_EXPIRES_SECONDS;
export const MAX_X402_CARTOGRAPHY_ROWS = 100_000;
export const MAX_X402_PAYLOAD_CANONICAL_BYTES = 64 * 1024;

const GROUPABLE_FIELD_TYPES = new Set(["text", "enum", "boolean"]);

const CartographyDimensionSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((field) => {
    const def = FIELD_CATALOG[field];
    return Boolean(def && GROUPABLE_FIELD_TYPES.has(def.type));
  }, "dimension must be a known groupable ODH field");

export const CartographyMetricSchema = z.enum([
  "count",
  "with_phone",
  "with_email",
  "with_phone_and_email",
  "sum_chiffre_affaires",
]);

export const X402CartographyPayloadSchema = z
  .object({
    kind: z.literal("odh_cartography"),
    filters: SearchFiltersSchema,
    dimensions: z.array(CartographyDimensionSchema).min(1).max(4),
    metrics: z.array(CartographyMetricSchema).min(1).max(8).default(["count"]),
    maxRows: z
      .number()
      .int()
      .positive()
      .max(MAX_X402_CARTOGRAPHY_ROWS)
      .default(10_000),
    resultFormat: z.enum(["jsonl", "csv", "parquet"]).default("jsonl"),
  })
  .strict();

export const X402CreateJobRequestSchema = z
  .object({
    clientIdempotencyKey: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    payload: X402CartographyPayloadSchema,
    expiresInSeconds: z
      .number()
      .int()
      .min(60)
      .max(MAX_X402_JOB_EXPIRES_SECONDS)
      .default(DEFAULT_X402_JOB_EXPIRES_SECONDS),
  })
  .strict();

export const X402ListJobsQuerySchema = z.object({
  status: z.enum(X402_JOB_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export const X402JobIdSchema = z.string().uuid();

export const X402ResultSchema = z
  .object({
    rawResultUri: z
      .string()
      .min(1)
      .max(2048)
      .refine(
        (uri) =>
          uri.startsWith("r2://") ||
          uri.startsWith("s3://") ||
          uri.startsWith("https://"),
        "rawResultUri must point to external object storage",
      ),
    rawResultSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    rowCount: z.number().int().nonnegative().optional(),
    summary: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type X402CreateJobRequest = z.infer<typeof X402CreateJobRequestSchema>;
export type X402CartographyPayload = z.infer<typeof X402CartographyPayloadSchema>;
export type X402JobStatus = (typeof X402_JOB_STATUSES)[number];
