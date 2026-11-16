/**
 * GET /api/atlas/communes/[dep] — contours des communes d'un département pour la carte (API Géo de l'État,
 * projetés et simplifiés, voir src/atlas/communes.ts). Données publiques, mais servies aux seules sessions :
 * la route ne doit pas devenir un relais ouvert vers geo.api.gouv.fr.
 */
import { NextRequest, NextResponse } from "next/server";

import { getUserContext } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import { departementValide, geometrieCommunes } from "@/atlas/communes";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ dep: string }> }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRateLimited(`atlas-communes:${ctx.userId}`, 60, 60_000)) return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 });
  const { dep } = await params;
  const code = dep.toUpperCase();
  if (!departementValide(code)) return NextResponse.json({ error: "département invalide" }, { status: 400 });
  try {
    const communes = await geometrieCommunes(code);
    return NextResponse.json({ departement: code, communes }, { headers: { "Cache-Control": "private, max-age=86400" } });
  } catch (e) {
    console.error(`[atlas] communes ${code} :`, e);
    return NextResponse.json({ error: "Contours des communes indisponibles" }, { status: 502 });
  }
}
