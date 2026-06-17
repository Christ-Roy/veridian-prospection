// ============================================================================
// search/query.ts — Moteur de recherche : JSON de filtres → SQL paramétré.
//
// L'IA (ou un client) envoie un JSON de conditions composables. Ce module :
//   1. valide le JSON (Zod) — rejette tout champ/opérateur hors catalogue ;
//   2. le traduit en bloc WHERE SQL PARAMÉTRÉ (binding $n, zéro interpolation).
//
// Principe de sécurité (cf CLAUDE.md) : ZÉRO SQL libre. Le nom de colonne vient
// TOUJOURS de FIELD_CATALOG (whitelist), jamais de l'input. Les valeurs passent
// TOUJOURS par le tableau `params` (binding positionnel Postgres).
// ============================================================================

import { z } from "zod";
import { FIELD_CATALOG, resolveField, type SearchOperator } from "./fields";

// ─── Schéma d'une condition ──────────────────────────────────────────────────
// Une condition cible un `field`, applique un `op`, avec value/values/min/max
// selon l'opérateur. On valide la cohérence (field existe, op autorisé sur ce
// field, forme de la valeur) dans un superRefine.

const ScalarSchema = z.union([z.string().max(200), z.number(), z.boolean()]);

const ConditionSchema = z
  .object({
    field: z.string().min(1).max(64),
    op: z.enum([
      "eq", "neq", "gte", "lte", "gt", "lt", "between", "in", "exists", "contains",
    ]),
    value: ScalarSchema.optional(),
    values: z.array(ScalarSchema).max(500).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict()
  .superRefine((cond, ctx) => {
    const def = resolveField(cond.field);
    if (!def) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Champ inconnu: ${cond.field}` });
      return;
    }
    if (!def.ops.includes(cond.op as SearchOperator)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Opérateur '${cond.op}' non autorisé sur '${cond.field}' (autorisés: ${def.ops.join(", ")})`,
      });
      return;
    }
    // Forme de la valeur selon l'opérateur.
    switch (cond.op) {
      case "between":
        if (typeof cond.min !== "number" || typeof cond.max !== "number") {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `'between' exige min ET max numériques` });
        }
        break;
      case "in":
        if (!cond.values || cond.values.length === 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `'in' exige un tableau 'values' non vide` });
        }
        break;
      case "exists":
        if (typeof cond.value !== "boolean") {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `'exists' exige value: true|false` });
        }
        break;
      case "contains":
        if (typeof cond.value !== "string") {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `'contains' exige une value texte` });
        }
        break;
      default: // eq, neq, gte, lte, gt, lt
        if (cond.value === undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `'${cond.op}' exige une 'value'` });
        }
        // enum : la value doit être dans enumValues
        if (def.type === "enum" && def.enumValues && typeof cond.value === "string" && !def.enumValues.includes(cond.value)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Valeur '${cond.value}' invalide pour '${cond.field}' (attendu: ${def.enumValues.join(", ")})` });
        }
    }
  });

export type Condition = z.infer<typeof ConditionSchema>;

// ─── Schéma de la requête de filtres ────────────────────────────────────────
// `all` = AND, `any` = OR. Les deux sont optionnels ; combinés en AND entre eux
// (toutes les conditions de `all` ET au moins une de `any`).
export const SearchFiltersSchema = z
  .object({
    all: z.array(ConditionSchema).max(50).optional(),
    any: z.array(ConditionSchema).max(50).optional(),
  })
  .strict()
  .refine((f) => (f.all && f.all.length > 0) || (f.any && f.any.length > 0), {
    message: "Au moins une condition (all ou any) est requise",
  });

export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

// ─── Traducteur condition → SQL paramétré ───────────────────────────────────

const OP_SQL: Record<string, string> = {
  eq: "=", neq: "!=", gte: ">=", lte: "<=", gt: ">", lt: "<",
};

function conditionToSql(
  cond: Condition,
  params: unknown[],
  startIdx: number,
): { sql: string; nextIdx: number } {
  const def = FIELD_CATALOG[cond.field];
  const col = def.sql; // whitelisté, jamais l'input
  let idx = startIdx;

  // Cast booléen : pour exists/eq sur un champ boolean, on compare au littéral.
  const castVal = (v: unknown): unknown => {
    if (def.type === "number" && typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    return v;
  };

  switch (cond.op) {
    case "exists":
      return { sql: cond.value === true ? `${col} IS NOT NULL` : `${col} IS NULL`, nextIdx: idx };

    case "between": {
      params.push(cond.min, cond.max);
      const a = `$${idx++}`, b = `$${idx++}`;
      return { sql: `${col} BETWEEN ${a} AND ${b}`, nextIdx: idx };
    }

    case "in": {
      const placeholders = (cond.values ?? []).map((v) => {
        params.push(castVal(v));
        return `$${idx++}`;
      });
      return { sql: `${col} IN (${placeholders.join(",")})`, nextIdx: idx };
    }

    case "contains":
      params.push(`%${cond.value}%`);
      return { sql: `${col} ILIKE $${idx++}`, nextIdx: idx };

    default: {
      // eq, neq, gte, lte, gt, lt
      params.push(castVal(cond.value));
      return { sql: `${col} ${OP_SQL[cond.op]} $${idx++}`, nextIdx: idx };
    }
  }
}

/**
 * Construit le bloc WHERE additionnel à partir des filtres validés.
 * Retourne le SQL (préfixé " AND (...)") + les params + le prochain index.
 *
 * @param filters  filtres DÉJÀ validés par SearchFiltersSchema
 * @param startIndex index du premier paramètre positionnel disponible
 */
export function buildSearchWhereSql(
  filters: SearchFilters,
  startIndex: number = 1,
): { sql: string; params: unknown[]; nextIndex: number } {
  const params: unknown[] = [];
  let idx = startIndex;
  const groups: string[] = [];

  if (filters.all && filters.all.length > 0) {
    const parts = filters.all.map((c) => {
      const r = conditionToSql(c, params, idx);
      idx = r.nextIdx;
      return r.sql;
    });
    groups.push(`(${parts.join(" AND ")})`);
  }

  if (filters.any && filters.any.length > 0) {
    const parts = filters.any.map((c) => {
      const r = conditionToSql(c, params, idx);
      idx = r.nextIdx;
      return r.sql;
    });
    groups.push(`(${parts.join(" OR ")})`);
  }

  const sql = groups.length > 0 ? ` AND ${groups.join(" AND ")}` : "";
  return { sql, params, nextIndex: idx };
}
