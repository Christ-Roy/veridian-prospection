/**
 * Filtre d'un segment Atlas : une liste de conditions génériques { champ, op, valeur } sur le
 * catalogue (src/atlas/champs.ts), toutes vraies à la fois. Traduit en SQL ClickHouse paramétré.
 *
 * Sécurité : le champ doit exister au catalogue (expression SQL fixe), l'opérateur doit être permis
 * pour son type, et chaque valeur passe en paramètre typé ({p0:Array(String)}…). Aucun texte fourni
 * par un utilisateur ou une IA n'est concaténé dans le SQL.
 */
import { z } from "zod";

import { CHAMP, OPERATEURS, type Champ } from "./champs";

const ConditionSchema = z
  .object({
    champ: z.string().min(1).max(40),
    op: z.string().min(1).max(20),
    valeur: z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.union([z.string().max(100), z.number()])).max(300)]).optional(),
  })
  .strict();

export const FiltreSchema = z
  .object({
    conditions: z.array(ConditionSchema).max(40).default([]),
    inclure_bloques: z.boolean().default(false).describe("Inclure les entreprises bloquées par ODH (cessées, sans contact…)"),
  })
  .strict();

export type Condition = z.infer<typeof ConditionSchema>;
export type Filtre = z.infer<typeof FiltreSchema>;
export type SqlParam = { type: string; valeur: unknown };
export type Compile = { where: string; params: Record<string, SqlParam> };

export class FiltreInvalide extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Critère de scoring : une condition du catalogue et son poids. */
export const ScoringSchema = z
  .object({
    criteres: z.array(ConditionSchema.extend({ poids: z.number().min(0.1).max(100) }).strict()).min(1).max(30),
  })
  .strict();
export type Scoring = z.infer<typeof ScoringSchema>;

function lire<T>(schema: z.ZodType<T>, brut: unknown): T {
  const r = schema.safeParse(brut ?? {});
  if (!r.success) throw new FiltreInvalide(r.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; "));
  return r.data;
}

/**
 * Traduit un filtre (et un scoring éventuel) en SQL paramétré. Le score vaut la somme des poids des
 * critères vrais, ramenée sur 100. Lève FiltreInvalide avec un message lisible.
 */
export function compilerFiltre(brut: unknown, scoringBrut?: unknown): Compile & { score?: string } {
  const f = lire(FiltreSchema, brut);
  const clauses: string[] = ["is_deleted = 0"];
  if (!f.inclure_bloques) clauses.push("empty(blocking_reasons)");
  const params: Record<string, SqlParam> = {};
  let n = 0;
  const p = (type: string, valeur: unknown) => {
    const nom = `p${n++}`;
    params[nom] = { type, valeur };
    return `{${nom}:${type}}`;
  };

  f.conditions.forEach((c, i) => clauses.push(compilerCondition(c, i, p)));
  if (scoringBrut === undefined) return { where: clauses.join(" AND "), params };

  const s = lire(ScoringSchema, scoringBrut);
  const total = s.criteres.reduce((a, c) => a + c.poids, 0);
  const termes = s.criteres.map((c, i) => `if(ifNull(${compilerCondition(c, i, p)}, 0), ${p("Float64", c.poids)}, 0)`);
  const score = `round((${termes.join(" + ")}) * 100 / ${p("Float64", total)})`;
  return { where: clauses.join(" AND "), params, score };
}

function compilerCondition(c: Condition, i: number, p: (type: string, v: unknown) => string): string {
  const champ = CHAMP.get(c.champ);
  if (!champ) throw new FiltreInvalide(`conditions.${i} : champ inconnu « ${c.champ} »`);
  if (!OPERATEURS[champ.type].includes(c.op)) {
    throw new FiltreInvalide(`conditions.${i} : opérateur « ${c.op} » impossible sur ${champ.libelle} (${OPERATEURS[champ.type].join(", ")})`);
  }
  const col = champ.sql;
  const err = (attendu: string) => new FiltreInvalide(`conditions.${i} : ${champ.libelle} « ${c.op} » attend ${attendu}`);
  const v = c.valeur;

  if (c.op === "renseigne") {
    if (typeof v !== "boolean") throw err("oui ou non (true/false)");
    if (champ.type === "nombre") return v ? `${col} IS NOT NULL` : `${col} IS NULL`;
    return v ? `${col} != ''` : `${col} = ''`;
  }
  switch (champ.type) {
    case "texte":
      if (typeof v !== "string" || !v.trim()) throw err("un texte");
      return c.op === "egal" ? `${col} = ${p("String", v)}` : `positionCaseInsensitiveUTF8(${col}, ${p("String", v)}) > 0`;
    case "liste": {
      const l = Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : null;
      if (!l?.length) throw err("une ou plusieurs valeurs");
      return `${col} ${c.op === "hors" ? "NOT IN" : "IN"} ${p("Array(String)", l)}`;
    }
    case "nombre": {
      if (c.op === "entre") {
        if (!Array.isArray(v) || v.length !== 2 || v.some((x) => typeof x !== "number")) throw err("deux nombres [min, max]");
        return `${col} BETWEEN ${p("Float64", v[0])} AND ${p("Float64", v[1])}`;
      }
      if (typeof v !== "number" || !Number.isFinite(v)) throw err("un nombre");
      return `${col} ${c.op === "min" ? ">=" : "<="} ${p("Float64", v)}`;
    }
    case "date":
      if (typeof v !== "string" || !DATE.test(v)) throw err("une date AAAA-MM-JJ");
      return `${col} ${c.op === "apres" ? ">=" : "<"} ${p("Date", v)}`;
    case "oui_non":
      if (typeof v !== "boolean") throw err("oui ou non (true/false)");
      return `${col} = ${v ? 1 : 0}`;
  }
}

/** Expressions SELECT pour les colonnes choisies (ids du catalogue), alias = id. */
export function colonnesSql(ids: readonly string[]): { sql: string; champs: Champ[] } {
  const champs = [...new Set(["siren", ...ids])].map((id) => {
    const c = CHAMP.get(id);
    if (!c) throw new FiltreInvalide(`colonne inconnue « ${id} »`);
    return c;
  });
  if (champs.length > 25) throw new FiltreInvalide("25 colonnes au plus");
  return { sql: champs.map((c) => `${c.sql} AS ${c.id}`).join(", "), champs };
}
