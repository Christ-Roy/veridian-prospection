import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/api-auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/leads/[siren]/history
 *
 * Returns the INPI financial history for a given SIREN (last 10 years, ordered desc).
 * Used by the lead-sheet to render a mini sparkline / table of CA over time.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const { domain: siren } = await params;

  // Validate SIREN format (9 digits)
  if (!/^\d{9}$/.test(siren)) {
    return NextResponse.json({ error: "Invalid SIREN" }, { status: 400 });
  }

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT annee, ca_net, resultat_net, ebe, charges_personnel, total_actif
     FROM inpi_history
     WHERE siren = $1
     ORDER BY annee DESC
     LIMIT 10`,
    siren
  );

  // Convert BigInt to Number for JSON serialization
  const data = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])
    )
  );

  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
