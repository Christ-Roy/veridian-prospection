import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/supabase/api-auth";

// GET /api/sectors — returns sector/domaine tree with counts
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  // Post-SIREN refactor: entreprises holds the canonical secteur/domaine.
  const rows = await prisma.$queryRaw<{ secteur_final: string; domaine_final: string | null; count: bigint }[]>`
    SELECT secteur_final, domaine_final, COUNT(*) as count
    FROM entreprises
    WHERE secteur_final IS NOT NULL
    GROUP BY secteur_final, domaine_final
    ORDER BY secteur_final, count DESC
  `;

  // Build tree: { secteur: { total, domaines: { domaine: count } } }
  const tree: Record<string, { total: number; domaines: Record<string, number> }> = {};

  for (const row of rows) {
    const s = row.secteur_final;
    const d = row.domaine_final || "(Non classé)";
    const c = Number(row.count);

    if (!tree[s]) tree[s] = { total: 0, domaines: {} };
    tree[s].total += c;
    tree[s].domaines[d] = (tree[s].domaines[d] || 0) + c;
  }

  return NextResponse.json(tree, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
