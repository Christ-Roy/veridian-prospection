// GET /api/entreprises/segments/[id]?limit=50&offset=0 — paginated rows of a segment VIEW.
//
// The segment must be registered in `segment_catalog`. The VIEW name is used as-is
// in a raw SQL query (safe because it comes from the catalog, not user input).
//
// Response: { id, viewName, description, volume, rows: [...], limit, offset }

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/user-context";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const VIEW_NAME_RE = /^v_[a-z0-9_]+$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const sp = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? "50", 10) || 50, 1), 500);
  const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10) || 0, 0);

  // Resolve view_name from segment_catalog (prevents injection, since VIEW names come from our own DB)
  const catalogRows = await prisma.$queryRaw<
    { segment_id: string; view_name: string; description: string; volume: number | null }[]
  >`
    SELECT segment_id, view_name, description, volume
    FROM segment_catalog
    WHERE segment_id = ${id}
    LIMIT 1
  `;

  if (catalogRows.length === 0) {
    return NextResponse.json({ error: "Segment not found" }, { status: 404 });
  }

  const seg = catalogRows[0];
  if (!VIEW_NAME_RE.test(seg.view_name)) {
    return NextResponse.json({ error: "Invalid view name" }, { status: 500 });
  }

  // Whitelist-safe interpolation (view_name matched against regex + came from our own catalog)
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      siren: string;
      denomination: string | null;
      commune: string | null;
      departement: string | null;
      prospect_score: number | null;
      best_phone_e164: string | null;
      best_email_normalized: string | null;
      web_domain_normalized: string | null;
      chiffre_affaires: bigint | null;
      est_rge: boolean | null;
      est_qualiopi: boolean | null;
      dirigeant_prenom: string | null;
      dirigeant_nom: string | null;
    }>
  >(
    `SELECT siren, denomination, commune, departement, prospect_score,
            best_phone_e164, best_email_normalized, web_domain_normalized,
            chiffre_affaires, est_rge, est_qualiopi, dirigeant_prenom, dirigeant_nom
     FROM ${seg.view_name}
     ORDER BY prospect_score DESC NULLS LAST, chiffre_affaires DESC NULLS LAST
     LIMIT $1 OFFSET $2`,
    limit,
    offset
  );

  return NextResponse.json(
    {
      id: seg.segment_id,
      viewName: seg.view_name,
      description: seg.description,
      volume: seg.volume ?? 0,
      rows: rows.map((r) => ({
        ...r,
        chiffre_affaires: r.chiffre_affaires === null ? null : Number(r.chiffre_affaires),
      })),
      limit,
      offset,
    },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
