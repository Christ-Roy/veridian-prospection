import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/supabase/api-auth";

/**
 * GET /api/stats/by-department — prospect count per department.
 *
 * Returns: { "01": 12345, "02": 6789, ... }
 * Used by: France map heatmap, geo filter counts, admin dashboard.
 * Cached 5 minutes (prospect counts don't change fast).
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const rows = await prisma.$queryRaw<{ dept: string; count: bigint }[]>`
    SELECT departement AS dept, COUNT(*) AS count
    FROM entreprises
    WHERE departement IS NOT NULL
      AND is_registrar = false
      AND COALESCE(ca_suspect, false) = false
    GROUP BY departement
    ORDER BY departement
  `;

  const result: Record<string, number> = {};
  for (const row of rows) {
    if (row.dept) result[row.dept] = Number(row.count);
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
}
