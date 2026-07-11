// ============================================================================
// search/distribution.ts — "explorer les distributions comme une vraie DB".
//
// Le complément d'/estimate : au lieu de "ce segment fait combien ?", on répond
// "COMMENT ce segment se répartit ?". Deux modes exclusifs :
//
//   • group_by <champ categoriel>  → top-N des valeurs les plus fréquentes,
//     avec les volumes actionnables (téléphone / email) par valeur.
//     Ex: group_by=ecom_platform → [{key:'woocommerce', count, with_phone, ...}]
//
//   • metric <champ numérique>     → statistiques de distribution (min/max/avg/
//     médiane/p25/p75/p90) + histogramme (width_bucket entre min et max).
//     Ex: metric=chiffre_affaires → percentiles + tranches.
//
// Sécurité (cf CLAUDE.md, identique à query.ts) : ZÉRO SQL libre. Le champ à
// grouper/mesurer DOIT être une clé de FIELD_CATALOG ; le nom de colonne vient
// TOUJOURS de FIELD_CATALOG[x].sql (jamais de l'input). Les filtres de contexte
// passent par buildSearchWhereSql (binding $n). L'exécution est bornée par
// withSearchTimeout (statement_timeout Postgres).
// ============================================================================

import { z } from "zod";
import { resolveField, type FieldDef } from "./fields";
import { buildSearchWhereSql, SearchFiltersSchema, type SearchFilters } from "./query";
import { withSearchTimeout } from "./exec";
import { DEFAULT_ENTREPRISES_WHERE } from "@/lib/queries/shared";

// ─── Bornes des paramètres ───────────────────────────────────────────────────
const DEFAULT_TOP = 20;
const MIN_TOP = 1;
const MAX_TOP = 100;
const DEFAULT_BUCKETS = 10;
const MIN_BUCKETS = 3;
const MAX_BUCKETS = 30;

// ─── Schéma du body ──────────────────────────────────────────────────────────
// filters optionnel (défaut = tout le référentiel). group_by OU metric requis,
// mutuellement exclusifs (l'un est catégoriel, l'autre numérique).
export const DistributionRequestSchema = z
  .object({
    filters: SearchFiltersSchema.optional(),
    group_by: z.string().min(1).max(64).optional(),
    metric: z.string().min(1).max(64).optional(),
    buckets: z.number().int().optional(),
    top: z.number().int().optional(),
  })
  .strict()
  .refine((b) => Boolean(b.group_by) || Boolean(b.metric), {
    message: "Fournis 'group_by' (champ catégoriel) OU 'metric' (champ numérique).",
  })
  .refine((b) => !(b.group_by && b.metric), {
    message: "'group_by' et 'metric' sont exclusifs — choisis l'un ou l'autre.",
  });

export type DistributionRequest = z.infer<typeof DistributionRequestSchema>;

// ─── Types de retour ─────────────────────────────────────────────────────────
export interface GroupByBucket {
  key: string;
  count: number;
  with_phone: number;
  with_email: number;
}

export interface GroupByResult {
  mode: "group_by";
  field: string;
  label: string;
  total: number;
  top: number;
  buckets: GroupByBucket[];
}

export interface HistogramBar {
  bucket: number; // 1..buckets
  from: number;
  to: number;
  count: number;
}

export interface MetricResult {
  mode: "metric";
  field: string;
  label: string;
  stats: {
    count: number;
    min: number | null;
    max: number | null;
    avg: number | null;
    median: number | null;
    p25: number | null;
    p75: number | null;
    p90: number | null;
  };
  buckets: number;
  histogram: HistogramBar[];
}

export type DistributionResult = GroupByResult | MetricResult;

/** Erreur de validation métier (champ mal typé) → 400 avec message clair. */
export class DistributionValidationError extends Error {}

// ─── Éligibilité d'un champ ──────────────────────────────────────────────────
// group_by : dimensions "catégorielles" = enum / text / boolean. On refuse un
// number pur (trop de valeurs distinctes → guide vers metric) et une date.
function assertGroupable(field: string): FieldDef {
  const def = resolveField(field);
  if (!def) {
    throw new DistributionValidationError(`Champ inconnu pour group_by: ${field}`);
  }
  if (def.type === "number") {
    throw new DistributionValidationError(
      `'${field}' est numérique — utilise 'metric' (percentiles + histogramme), pas 'group_by'.`,
    );
  }
  if (def.type === "date") {
    throw new DistributionValidationError(
      `'${field}' est une date — le group_by par date n'est pas supporté (utilise des filtres de plage).`,
    );
  }
  return def;
}

// metric : uniquement les champs numériques (percentiles/histogramme n'ont de
// sens que là). Un champ texte/enum est renvoyé vers group_by.
function assertNumeric(field: string): FieldDef {
  const def = resolveField(field);
  if (!def) {
    throw new DistributionValidationError(`Champ inconnu pour metric: ${field}`);
  }
  if (def.type !== "number") {
    throw new DistributionValidationError(
      `'${field}' n'est pas numérique — utilise 'group_by' pour ventiler cette dimension.`,
    );
  }
  return def;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const toNum = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Calcule une distribution (group_by OU metric) sur le référentiel `entreprises`,
 * filtré par le contexte optionnel + les filtres par défaut (is_registrar, ca_suspect).
 *
 * @param req  requête DÉJÀ validée par DistributionRequestSchema
 */
export async function computeDistribution(req: DistributionRequest): Promise<DistributionResult> {
  // Filtres de contexte → WHERE paramétré (ou vide = tout le référentiel).
  const filters: SearchFilters | undefined = req.filters;
  const { sql: whereSql, params } = filters
    ? buildSearchWhereSql(filters, 1)
    : { sql: "", params: [] as unknown[] };
  const baseFrom = `FROM entreprises e WHERE ${DEFAULT_ENTREPRISES_WHERE}${whereSql}`;

  if (req.group_by) {
    return computeGroupBy(req.group_by, req.top, baseFrom, params);
  }
  // Le schéma garantit metric présent si group_by absent.
  return computeMetric(req.metric as string, req.buckets, baseFrom, params);
}

// ─── group_by catégoriel ─────────────────────────────────────────────────────
async function computeGroupBy(
  field: string,
  topRaw: number | undefined,
  baseFrom: string,
  params: unknown[],
): Promise<GroupByResult> {
  const def = assertGroupable(field);
  const top = clamp(Math.floor(topRaw ?? DEFAULT_TOP), MIN_TOP, MAX_TOP);
  const col = def.sql; // whitelisté, jamais l'input

  // COALESCE en '(inconnu)' pour ne pas perdre les NULL dans le top-N.
  // ::text pour homogénéiser (un enum/bool casté proprement en clé lisible).
  const rows = await withSearchTimeout((q) =>
    q<{ key: string | null; count: bigint; with_phone: bigint; with_email: bigint }[]>(
      `SELECT COALESCE((${col})::text, '(inconnu)') AS key,
              COUNT(*)::bigint AS count,
              COUNT(*) FILTER (WHERE e.best_phone_e164 IS NOT NULL)::bigint AS with_phone,
              COUNT(*) FILTER (WHERE e.best_email_normalized IS NOT NULL)::bigint AS with_email
       ${baseFrom}
       GROUP BY 1
       ORDER BY 2 DESC
       LIMIT ${top}`,
      ...params,
    ),
  );

  const buckets: GroupByBucket[] = rows.map((r) => ({
    key: r.key ?? "(inconnu)",
    count: Number(r.count),
    with_phone: Number(r.with_phone),
    with_email: Number(r.with_email),
  }));
  const total = buckets.reduce((acc, b) => acc + b.count, 0);

  return { mode: "group_by", field, label: def.label, total, top, buckets };
}

// ─── metric numérique : percentiles + histogramme ────────────────────────────
async function computeMetric(
  field: string,
  bucketsRaw: number | undefined,
  baseFrom: string,
  params: unknown[],
): Promise<MetricResult> {
  const def = assertNumeric(field);
  const nBuckets = clamp(Math.floor(bucketsRaw ?? DEFAULT_BUCKETS), MIN_BUCKETS, MAX_BUCKETS);
  // Le champ peut être une expression (ex: âge dirigeant) → on l'enveloppe.
  const expr = `(${def.sql})`;

  return withSearchTimeout(async (q) => {
    // Passe 1 : stats + percentiles (ignore les NULL). PERCENTILE_CONT interpole.
    const [stats] = await q<
      {
        count: bigint;
        min: number | null;
        max: number | null;
        avg: number | null;
        median: number | null;
        p25: number | null;
        p75: number | null;
        p90: number | null;
      }[]
    >(
      `SELECT COUNT(${expr})::bigint AS count,
              MIN(${expr})::float8 AS min,
              MAX(${expr})::float8 AS max,
              AVG(${expr})::float8 AS avg,
              PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${expr})::float8 AS median,
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${expr})::float8 AS p25,
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${expr})::float8 AS p75,
              PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY ${expr})::float8 AS p90
       ${baseFrom}`,
      ...params,
    );

    const count = Number(stats.count);
    const min = toNum(stats.min);
    const max = toNum(stats.max);

    const statsOut = {
      count,
      min,
      max,
      avg: toNum(stats.avg),
      median: toNum(stats.median),
      p25: toNum(stats.p25),
      p75: toNum(stats.p75),
      p90: toNum(stats.p90),
    };

    // Histogramme impossible si aucune valeur ou min==max (pas de plage).
    if (count === 0 || min === null || max === null || min === max) {
      const histogram: HistogramBar[] =
        count > 0 && min !== null && max !== null
          ? [{ bucket: 1, from: min, to: max, count }] // toutes les valeurs identiques
          : [];
      return { mode: "metric", field, label: def.label, stats: statsOut, buckets: nBuckets, histogram };
    }

    // Passe 2 : histogramme via width_bucket. On borne à [min, max]. Les valeurs
    // == max tombent dans un bucket "débordement" (nBuckets+1) que l'on ramène
    // dans le dernier bucket légitime, comportement standard d'un histo fermé.
    // min/max sont bindés en params ($n) pour rester paramétré.
    const minIdx = params.length + 1;
    const maxIdx = params.length + 2;
    const bins = await q<{ bucket: number; count: bigint }[]>(
      `SELECT LEAST(
                width_bucket(${expr}, $${minIdx}::float8, $${maxIdx}::float8, ${nBuckets}),
                ${nBuckets}
              ) AS bucket,
              COUNT(*)::bigint AS count
       ${baseFrom} AND ${expr} IS NOT NULL
       GROUP BY 1
       ORDER BY 1`,
      ...params,
      min,
      max,
    );

    // Reconstruit tous les buckets (même vides) pour un histogramme dense.
    const width = (max - min) / nBuckets;
    const countByBucket = new Map<number, number>();
    for (const b of bins) countByBucket.set(Number(b.bucket), Number(b.count));

    const histogram: HistogramBar[] = [];
    for (let i = 1; i <= nBuckets; i++) {
      histogram.push({
        bucket: i,
        from: min + (i - 1) * width,
        to: i === nBuckets ? max : min + i * width,
        count: countByBucket.get(i) ?? 0,
      });
    }

    return { mode: "metric", field, label: def.label, stats: statsOut, buckets: nBuckets, histogram };
  });
}
