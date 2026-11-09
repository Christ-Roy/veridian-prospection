/**
 * GET /api/atlas/export?segment_id=…&format=xlsx|csv — export d'un segment, réservé aux plans payants
 * (Robert, 09/11). Espace de la session, jamais un argument ; 5 000 lignes au plus, classées par la
 * priorité du segment ; 20 exports par heure et par utilisateur ; chaque export est journalisé.
 * Pas d'outil MCP : un export passe par un clic humain (docs/PLAN-ATLAS.md).
 */
import { NextRequest, NextResponse } from "next/server";

import { getUserContext } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { colonnesExport, LIGNES_MAX_EXPORT, nomFichier, peutExporter, versCsv, versXlsx, type FormatExport } from "@/atlas/export";
import { FiltreInvalide } from "@/atlas/filtres";
import * as seg from "@/atlas/segments";
import { sourceMarche } from "@/atlas/source";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = request.nextUrl.searchParams;
  const segmentId = q.get("segment_id") ?? "";
  const format = (q.get("format") ?? "xlsx") as FormatExport;
  if (!UUID.test(segmentId)) return NextResponse.json({ error: "segment_id invalide" }, { status: 400 });
  if (format !== "xlsx" && format !== "csv") return NextResponse.json({ error: "format : xlsx ou csv" }, { status: 400 });

  const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { plan: true } });
  if (!peutExporter(tenant?.plan)) {
    return NextResponse.json({ error: "export_reserve_plan_payant", message: "L'export est réservé aux plans payants Veridian." }, { status: 402 });
  }
  if (isRateLimited(`atlas-export:${ctx.userId}`, 20, 3_600_000)) {
    return NextResponse.json({ error: "Trop d'exports cette heure (20 au plus)." }, { status: 429 });
  }

  try {
    const s = await seg.lireSegment(ctx.tenantId, segmentId);
    const [filtre, scoring] = await Promise.all([seg.filtreEffectif(ctx.tenantId, s.id), seg.scoringCourant(ctx.tenantId, s.id)]);
    const colonnes = colonnesExport(s.colonnes);
    const r = await sourceMarche().apercu(filtre, { colonnes, page: 1, parPage: LIGNES_MAX_EXPORT, plafond: LIGNES_MAX_EXPORT, ...(scoring ? { scoring } : {}) });
    const corps = format === "csv" ? versCsv(r.colonnes, r.lignes) : versXlsx(r.colonnes, r.lignes, s.nom);
    console.info(`[atlas] export user=${ctx.userId} tenant=${ctx.tenantId} segment=${s.id} format=${format} lignes=${r.lignes.length}`);
    return new NextResponse(new Uint8Array(corps), {
      headers: {
        "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nomFichier(s.nom, format)}"`,
        "Cache-Control": "no-store",
        "X-Atlas-Lignes": String(r.lignes.length),
      },
    });
  } catch (e) {
    if (e instanceof seg.Introuvable) return NextResponse.json({ error: "segment introuvable" }, { status: 404 });
    if (e instanceof FiltreInvalide) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[atlas] export :", e);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
