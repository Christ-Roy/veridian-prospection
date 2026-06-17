/**
 * POST /api/search/estimate — compte un segment SANS le matérialiser + breakdown.
 *
 * Le moteur d'itération de l'IA : "ce segment fait combien ? trop large →
 * j'affine". Retourne un COUNT + un breakdown par dimension clé pour guider
 * l'affinage, + les volumes actionnables (avec tel / email).
 *
 * Auth : bearer machine (SEARCH_API_SECRET). Pas d'exposition de leads (COUNT only).
 * Body : { filters: SearchFilters }  (cf src/lib/search/query.ts)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { authenticateSearch } from "@/lib/search/auth";
import { SearchFiltersSchema, buildSearchWhereSql } from "@/lib/search/query";
import { DEFAULT_ENTREPRISES_WHERE } from "@/lib/queries/shared";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = authenticateSearch(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (isRateLimited(`search-estimate:${auth.tenantId}`, 60, 60_000)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = SearchFiltersSchema.safeParse((body as { filters?: unknown })?.filters);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid filters", details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const { sql: whereSql, params } = buildSearchWhereSql(parsed.data, 1);
  const baseFrom = `FROM entreprises e WHERE ${DEFAULT_ENTREPRISES_WHERE}${whereSql}`;

  try {
    // COUNT global + volumes actionnables en une passe.
    const [agg] = await prisma.$queryRawUnsafe<
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

    // Breakdown par dimension — limité au top 8 par dimension pour rester rapide.
    // On ne calcule le breakdown que si le segment n'est pas vide.
    let breakdown: Record<string, { key: string; count: number }[]> = {};
    if (total > 0) {
      const [bySecteur, byDept] = await Promise.all([
        prisma.$queryRawUnsafe<{ key: string; count: bigint }[]>(
          `SELECT COALESCE(e.secteur_final,'(inconnu)') AS key, COUNT(*)::bigint AS count
           ${baseFrom} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
          ...params,
        ),
        prisma.$queryRawUnsafe<{ key: string; count: bigint }[]>(
          `SELECT COALESCE(e.departement,'(inconnu)') AS key, COUNT(*)::bigint AS count
           ${baseFrom} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
          ...params,
        ),
      ]);
      breakdown = {
        by_secteur: bySecteur.map((r) => ({ key: r.key, count: Number(r.count) })),
        by_departement: byDept.map((r) => ({ key: r.key, count: Number(r.count) })),
      };
    }

    return NextResponse.json({
      estimated_count: total,
      actionable: {
        with_phone: Number(agg.with_phone),
        with_email: Number(agg.with_email),
        with_phone_and_email: Number(agg.with_both),
      },
      breakdown,
    });
  } catch (err) {
    console.error("[search/estimate] query failed", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
