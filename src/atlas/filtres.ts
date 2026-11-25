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
import { clientsCourants } from "./clients-portee";
import { formesFamille, motsCles } from "./activites";
import { devine } from "./restreint";

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
  if (!r.success) {
    throw new FiltreInvalide(
      r.error.issues
        .map((i) =>
          i.code === "unrecognized_keys"
            ? `clé inconnue « ${i.keys.join("», «")} »${i.path.length ? ` dans ${i.path.join(".")}` : ""} : un filtre s'écrit { "conditions": [{ "champ": "naf", "op": "dans", "valeur": ["7500Z"] }] }`
            : `${i.path.join(".") || "filtre"} : ${i.message}`,
        )
        .join(" ; "),
    );
  }
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
  if (!champ) {
    // « code_naf » → naf, « ville » n'a pas de voisin : on renvoie au catalogue.
    const n = c.champ.toLowerCase();
    const proches = [...CHAMP.keys()].filter((k) => n.includes(k) || k.includes(n)).slice(0, 4);
    throw new FiltreInvalide(`conditions.${i} : champ inconnu « ${c.champ} »${proches.length ? `, peut-être ${proches.join(" ou ")}` : ""} (lister_champs donne les champs)`);
  }
  if (!OPERATEURS[champ.type].includes(c.op)) {
    throw new FiltreInvalide(`conditions.${i} : opérateur « ${c.op} » impossible sur ${champ.libelle} (${OPERATEURS[champ.type].join(", ")})`);
  }
  const devinee = devine(champ.id, c.op);
  if (devinee) throw new FiltreInvalide(`conditions.${i} : ${champ.libelle} ne se filtre ici que par « renseigne ». ${devinee}`);
  if (champ.espace) return clauseClients(c.valeur, p);
  const col = champ.sql;
  const err = (attendu: string) => new FiltreInvalide(`conditions.${i} : ${champ.libelle} « ${c.op} » attend ${attendu}`);
  const v = c.valeur;

  if (champ.tableau) {
    // Colonne tableau de la vue : une valeur parmi celles de la fiche.
    if (c.op === "renseigne") {
      if (typeof v !== "boolean") throw err("oui ou non (true/false)");
      return v ? `notEmpty(${col})` : `empty(${col})`;
    }
    const l = Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : null;
    if (!l?.length) throw err("une ou plusieurs valeurs");
    return `${c.op === "hors" ? "NOT " : ""}hasAny(${col}, ${p("Array(String)", l)})`;
  }
  if (champ.ensemble) {
    // Valeurs rangées dans une autre vue (une ligne par SIREN) : appartenance par sous-requête.
    const sous = (cond: string, dedans: boolean) => `siren ${dedans ? "IN" : "NOT IN"} (SELECT siren FROM ${champ.ensemble!.table} WHERE ${cond})`;
    if (c.op === "renseigne") {
      if (typeof v !== "boolean") throw err("oui ou non (true/false)");
      return sous(`notEmpty(${col})`, v);
    }
    const l = Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : null;
    if (!l?.length) throw err("une ou plusieurs valeurs");
    return sous(`hasAny(${col}, ${p("Array(String)", l)})`, c.op !== "hors");
  }

  if (c.op === "renseigne") {
    if (typeof v !== "boolean") throw err("oui ou non (true/false)");
    if (champ.type === "nombre") return v ? `${col} IS NOT NULL` : `${col} IS NULL`;
    return v ? `${col} != ''` : `${col} = ''`;
  }
  switch (champ.type) {
    case "texte":
      if (typeof v !== "string" || !v.trim()) throw err("un texte");
      if (champ.id === "nom" && c.op === "contient") {
        // Même recherche que le marché (mots entiers de la famille, enseigne comprise) : un même mot rend le même nombre partout.
        const mots = motsCles(v);
        if (mots.length) return `siren IN (SELECT siren FROM odh.company_master_current WHERE ${mots.map((m) => `hasAnyTokens(name_terms, ${p("Array(String)", formesFamille(m))})`).join(" AND ")})`;
      }
      return c.op === "egal" ? `${col} = ${p("String", v)}` : `positionCaseInsensitiveUTF8(${col}, ${p("String", v)}) > 0`;
    case "liste": {
      const l = Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : null;
      if (!l?.length) throw err("une ou plusieurs valeurs");
      // « 78.10Z » s'écrit 7810Z dans ODH : sans cela, le segment se créait vide, en silence (24/11).
      const valeurs = champ.id === "naf" ? l.map((x) => x.replace(/[.\s]/g, "").toUpperCase()) : l;
      return `${col} ${c.op === "hors" ? "NOT IN" : "IN"} ${p("Array(String)", valeurs)}`;
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

/** Taille d'un paramètre : ClickHouse refuse un champ d'URL de plus de 128 Ko. */
const LOT_SIREN = 5000;
/** `siren IN (…)` sur une longue liste, en plusieurs paramètres. */
export function parmiSirens(sirens: readonly string[], p: (type: string, v: unknown) => string): string {
  const lots = Array.from({ length: Math.ceil(sirens.length / LOT_SIREN) }, (_, i) => `siren IN ${p("Array(String)", sirens.slice(i * LOT_SIREN, (i + 1) * LOT_SIREN))}`);
  return lots.length ? `(${lots.join(" OR ")})` : "0";
}
/** Clients de l'espace : la liste vient de l'espace de l'appel (clients-portee.ts), jamais du filtre. */
export function clauseClients(v: unknown, p: (type: string, v: unknown) => string): string {
  if (typeof v !== "boolean") throw new FiltreInvalide("Est déjà client : attend oui ou non (true/false)");
  const sirens = clientsCourants();
  if (!sirens) throw new FiltreInvalide("Le filtre « Est déjà client » n'est pas disponible ici.");
  return v ? parmiSirens(sirens, p) : sirens.length ? `NOT ${parmiSirens(sirens, p)}` : "1";
}

/** Expressions SELECT pour les colonnes choisies (ids du catalogue), alias = id. */
export function colonnesSql(ids: readonly string[]): { sql: string; champs: Champ[]; jointures: string } {
  const champs = [...new Set(["siren", ...ids])].map((id) => {
    const c = CHAMP.get(id);
    if (!c || c.espace) throw new FiltreInvalide(`colonne inconnue « ${id} »`);
    return c;
  });
  if (champs.length > 25) throw new FiltreInvalide("25 colonnes au plus");
  // Colonnes rangées dans une autre vue : une jointure par vue, sur le SIREN, colonne renommée pour ne rien masquer.
  const jointures = [...new Set(champs.filter((c) => c.ensemble).map((c) => c.ensemble!.table))].map((table, k) => {
    const cols = champs.filter((c) => c.ensemble?.table === table);
    return { table, alias: `j${k}`, sql: `LEFT JOIN (SELECT siren, ${cols.map((c) => `${c.sql} AS __${c.id}`).join(", ")} FROM ${table}) AS j${k} USING (siren)` };
  });
  const select = champs.map((c) => {
    if (c.tableau) return `arrayStringConcat(${c.sql}, ', ') AS ${c.id}`;
    if (!c.ensemble) return `${c.sql} AS ${c.id}`;
    const j = jointures.find((x) => x.table === c.ensemble!.table)!;
    return `arrayStringConcat(${j.alias}.__${c.id}, ', ') AS ${c.id}`;
  });
  return { sql: select.join(", "), champs, jointures: jointures.map((j) => j.sql).join(" ") };
}
