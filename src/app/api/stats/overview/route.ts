import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

/**
 * GET /api/stats/overview — enriched stats for admin KPI dashboard.
 *
 * Returns aggregated counts: total enterprises, by certification, by
 * prospect tier, by financial health, pipeline summary, etc.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);

  const [totals, pipeline, inpi] = await Promise.all([
    prisma.$queryRaw<[{
      total: bigint; with_phone: bigint; with_email: bigint; with_site: bigint;
      rge: bigint; qualiopi: bigint; bio: bigint; epv: bigint; bni: bigint;
      diamond: bigint; gold: bigint;
    }]>`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE best_phone_e164 IS NOT NULL) AS with_phone,
        COUNT(*) FILTER (WHERE best_email_normalized IS NOT NULL) AS with_email,
        COUNT(*) FILTER (WHERE web_domain IS NOT NULL) AS with_site,
        COUNT(*) FILTER (WHERE est_rge = true) AS rge,
        COUNT(*) FILTER (WHERE est_qualiopi = true) AS qualiopi,
        COUNT(*) FILTER (WHERE est_bio = true) AS bio,
        COUNT(*) FILTER (WHERE est_epv = true) AS epv,
        COUNT(*) FILTER (WHERE est_bni = true) AS bni,
        COUNT(*) FILTER (WHERE prospect_score >= 80) AS diamond,
        COUNT(*) FILTER (WHERE prospect_score >= 60) AS gold
      FROM entreprises
      WHERE is_registrar = false AND COALESCE(ca_suspect, false) = false
    `,
    prisma.$queryRaw<{ status: string; count: bigint }[]>`
      SELECT status, COUNT(*) AS count
      FROM outreach
      WHERE tenant_id = ${tenantId ?? "00000000-0000-0000-0000-000000000000"}::uuid
        AND status != 'a_contacter'
      GROUP BY status
      ORDER BY count DESC
    `,
    prisma.$queryRaw<[{
      with_ca: bigint; with_history: bigint;
      growth_strong: bigint; decline: bigint; crash: bigint; top_profit: bigint;
    }]>`
      SELECT
        COUNT(*) FILTER (WHERE ca_last IS NOT NULL) AS with_ca,
        COUNT(*) FILTER (WHERE inpi_nb_exercices > 0) AS with_history,
        COUNT(*) FILTER (WHERE ca_trend_3y = 'growth_strong') AS growth_strong,
        COUNT(*) FILTER (WHERE ca_trend_3y = 'decline') AS decline,
        COUNT(*) FILTER (WHERE ca_trend_3y = 'crash') AS crash,
        COUNT(*) FILTER (WHERE profitability_tag = 'top') AS top_profit
      FROM entreprises
      WHERE is_registrar = false AND COALESCE(ca_suspect, false) = false
    `,
  ]);

  const t = totals[0];
  const i = inpi[0];

  return NextResponse.json({
    entreprises: {
      total: Number(t.total),
      withPhone: Number(t.with_phone),
      withEmail: Number(t.with_email),
      withSite: Number(t.with_site),
      certifications: {
        rge: Number(t.rge), qualiopi: Number(t.qualiopi),
        bio: Number(t.bio), epv: Number(t.epv), bni: Number(t.bni),
      },
      scoring: { diamond: Number(t.diamond), gold: Number(t.gold) },
    },
    inpi: {
      withCA: Number(i.with_ca),
      withHistory: Number(i.with_history),
      growthStrong: Number(i.growth_strong),
      decline: Number(i.decline),
      crash: Number(i.crash),
      topProfit: Number(i.top_profit),
    },
    pipeline: pipeline.map(r => ({ status: r.status, count: Number(r.count) })),
    timestamp: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
