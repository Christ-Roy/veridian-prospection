import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/supabase/api-auth";

// GET /api/sans-site-filters
// Returns certification buckets and Qualiopi specialite subtree for the
// "sans site" segment (entreprises with no web domain). Counts are scoped
// to the sans-site pool so the sidebar numbers match what the table shows
// when the ?site=without toggle is active.
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  // Shared predicate: no web presence + default anti-noise filters.
  // Kept in sync with the hasWebsite="without" clause in buildFilterWhere
  // and the DEFAULT_ENTREPRISES_WHERE snippet in shared.ts.
  const baseWhere = `
    e.is_registrar = false
    AND COALESCE(e.ca_suspect, false) = false
    AND e.web_domain_normalized IS NULL
    AND e.web_domain IS NULL
    AND (e.web_domains_all IS NULL OR jsonb_array_length(e.web_domains_all) = 0)
  `;

  const countsRows = await prisma.$queryRawUnsafe<{
    total: bigint;
    rge: bigint;
    qualiopi: bigint;
    epv: bigint;
    bni: bigint;
    bio: bigint;
    non_identifie_avec_tel: bigint;
  }[]>(`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE e.est_rge = true)::bigint AS rge,
      COUNT(*) FILTER (WHERE e.est_qualiopi = true)::bigint AS qualiopi,
      COUNT(*) FILTER (WHERE e.est_epv = true)::bigint AS epv,
      COUNT(*) FILTER (WHERE e.est_bni = true)::bigint AS bni,
      COUNT(*) FILTER (WHERE e.est_bio = true)::bigint AS bio,
      COUNT(*) FILTER (
        WHERE COALESCE(e.est_rge,false) = false
          AND COALESCE(e.est_qualiopi,false) = false
          AND COALESCE(e.est_bio,false) = false
          AND COALESCE(e.est_epv,false) = false
          AND COALESCE(e.est_bni,false) = false
          AND e.best_phone_e164 IS NOT NULL
      )::bigint AS non_identifie_avec_tel
    FROM entreprises e
    WHERE ${baseWhere}
  `);

  const qualiopiRows = await prisma.$queryRawUnsafe<{
    specialite: string;
    count: bigint;
  }[]>(`
    SELECT e.qualiopi_specialite AS specialite, COUNT(*)::bigint AS count
    FROM entreprises e
    WHERE ${baseWhere}
      AND e.est_qualiopi = true
      AND e.qualiopi_specialite IS NOT NULL
    GROUP BY e.qualiopi_specialite
    ORDER BY count DESC, specialite ASC
  `);

  const row = countsRows[0] ?? {
    total: BigInt(0),
    rge: BigInt(0),
    qualiopi: BigInt(0),
    epv: BigInt(0),
    bni: BigInt(0),
    bio: BigInt(0),
    non_identifie_avec_tel: BigInt(0),
  };

  return NextResponse.json(
    {
      total: Number(row.total),
      categories: {
        rge: Number(row.rge),
        qualiopi: Number(row.qualiopi),
        epv: Number(row.epv),
        bni: Number(row.bni),
        bio: Number(row.bio),
        nonIdentifieAvecTel: Number(row.non_identifie_avec_tel),
      },
      qualiopiSpecialites: qualiopiRows.map((r) => ({
        specialite: r.specialite,
        count: Number(r.count),
      })),
    },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
