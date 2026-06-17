// ============================================================================
// search/exec.ts — Exécution des requêtes search avec garde-fous DB.
//
// Garde-fou anti-DoS : toute requête du moteur de recherche s'exécute avec un
// `statement_timeout` Postgres. Une requête qui dépasse (filtre pathologique,
// segment monstrueux) est TUÉE par Postgres au lieu de bloquer une connexion
// indéfiniment. Le rate-limit applicatif borne le débit ; ce timeout borne le
// coût unitaire. Les deux ensemble = la DB ne peut pas être mise à genoux.
//
// Le breakdown GROUP BY large mesuré à ~330ms sur 996K → un timeout de 5s laisse
// une marge x15 pour les cas légitimes, tout en coupant net les requêtes folles.
// ============================================================================

import { prisma } from "@/lib/prisma";

/** Timeout dur (ms) appliqué à chaque requête search. */
export const SEARCH_STATEMENT_TIMEOUT_MS = 5000;

/**
 * Exécute une série de requêtes SQL paramétrées dans une transaction avec
 * `statement_timeout` posé. Retourne un runner `q(sql, ...params)`.
 *
 * Usage :
 *   const rows = await withSearchTimeout(async (q) => {
 *     const a = await q<MyRow[]>(sql1, ...p1);
 *     const b = await q<MyRow[]>(sql2, ...p2);
 *     return { a, b };
 *   });
 */
export async function withSearchTimeout<T>(
  fn: (q: <R>(sql: string, ...params: unknown[]) => Promise<R>) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // SET LOCAL : portée transaction uniquement, réinitialisé au COMMIT/ROLLBACK.
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${SEARCH_STATEMENT_TIMEOUT_MS}`);
    const q = <R>(sql: string, ...params: unknown[]): Promise<R> =>
      tx.$queryRawUnsafe<R>(sql, ...params) as Promise<R>;
    return fn(q);
  });
}

/**
 * Détecte une erreur de statement_timeout Postgres (SQLSTATE 57014).
 * Permet de répondre 400 "segment trop coûteux, affine" au lieu d'un 500 opaque.
 */
export function isStatementTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("57014") || /statement timeout|canceling statement due to statement timeout/i.test(msg);
}
