import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/supabase/api-auth";

/**
 * GET /api/stats/segments — segment_catalog with current volumes.
 *
 * Returns the segment catalog rows if the table exists, otherwise
 * computes a minimal set of key segment counts on the fly.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    // Try segment_catalog first (populated by migration views)
    const catalog = await prisma.$queryRaw<
      { segment_id: string; view_name: string; description: string; volume: number }[]
    >`SELECT segment_id, view_name, description, volume::integer FROM segment_catalog ORDER BY volume DESC`;

    return NextResponse.json({ segments: catalog }, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    // segment_catalog doesn't exist — compute key counts inline
    const BASE = "is_registrar = false AND COALESCE(ca_suspect, false) = false";
    const counts = await prisma.$queryRaw<{ id: string; vol: bigint }[]>`
      SELECT 'rge_sans_site' AS id, COUNT(*)::bigint AS vol FROM entreprises WHERE ${prisma.$queryRawUnsafe(BASE)} AND est_rge = true AND web_domain IS NULL AND best_phone_e164 IS NOT NULL
      UNION ALL SELECT 'qualiopi_sans_site', COUNT(*) FROM entreprises WHERE est_qualiopi = true AND web_domain IS NULL AND best_phone_e164 IS NOT NULL AND is_registrar = false
      UNION ALL SELECT 'pme_ca500k_sans_site', COUNT(*) FROM entreprises WHERE chiffre_affaires >= 500000 AND web_domain IS NULL AND best_phone_e164 IS NOT NULL AND is_registrar = false
      UNION ALL SELECT 'diamond', COUNT(*) FROM entreprises WHERE prospect_score >= 80 AND is_registrar = false
      UNION ALL SELECT 'gold', COUNT(*) FROM entreprises WHERE prospect_score >= 60 AND is_registrar = false
    `;

    return NextResponse.json({
      segments: counts.map(r => ({
        segment_id: r.id,
        view_name: `v_${r.id}`,
        description: r.id.replace(/_/g, " "),
        volume: Number(r.vol),
      })),
    }, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }
}
