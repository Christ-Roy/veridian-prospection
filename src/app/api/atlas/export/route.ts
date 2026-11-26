/**
 * GET /api/atlas/export?segment_id=…&format=xlsx|csv — export d'un segment, réservé aux plans payants
 * (Robert, 09/11). Espace de la session, jamais un argument ; 5 000 lignes au plus, classées par la
 * priorité du segment ; 20 exports par heure et par utilisateur ; chaque export est tracé dans atlas_exports et
 * compte dans le quota de 5 000 lignes par jour et par espace, avec l'extraction et les envois (Robert, 26/11).
 * Les lignes sont réservées avant la lecture d'ODH ; un export qui dépasse le reste du jour est coupé à ce reste.
 * Par une IA, l'extraction paginée est l'outil MCP extraire_segment (src/atlas/extraction.ts).
 */
import { NextRequest, NextResponse } from "next/server";

import { getUserContext, refusSansContexte } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { avecClients } from "@/atlas/clients";
import { colonnesExport, LIGNES_MAX_EXPORT, nomFichier, peutExporter, versCsv, versXlsx, type FormatExport } from "@/atlas/export";
import { RefusExtraction, reserverExport } from "@/atlas/extraction";
import { FiltreInvalide } from "@/atlas/filtres";
import * as seg from "@/atlas/segments";
import { sourceMarche } from "@/atlas/source";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return refusSansContexte();
  if (ctx.lectureSeule) return NextResponse.json({ error: ctx.lectureSeule, message: "Espace en lecture seule : l'export est suspendu." }, { status: 402 });

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
    // Réservé avant de lire ODH : un export sans trace n'est pas servi, et le quota du jour borne le fichier.
    const res = await reserverExport({ tenantId: ctx.tenantId, userId: ctx.userId, client: null, format, segmentId: s.id, segmentVersion: s.version }, LIGNES_MAX_EXPORT);
    let r;
    try {
      r = await avecClients(ctx.tenantId, () => sourceMarche().apercu(filtre, { colonnes, page: 1, parPage: res.taille, plafond: res.taille, livrablesSeuls: true, ...(scoring ? { scoring } : {}) }));
      if (r.lignes.length !== res.taille) await res.ajuster(r.lignes.length);
    } catch (e) {
      await res.annuler().catch(() => undefined);
      throw e;
    }
    const corps = format === "csv" ? versCsv(r.colonnes, r.lignes) : versXlsx(r.colonnes, r.lignes, s.nom);
    const coupe = res.taille < LIGNES_MAX_EXPORT && r.lignes.length === res.taille;
    console.info(`[atlas] export user=${ctx.userId} tenant=${ctx.tenantId} segment=${s.id} format=${format} lignes=${r.lignes.length}`);
    return new NextResponse(new Uint8Array(corps), {
      headers: {
        "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nomFichier(s.nom, format)}"`,
        "Cache-Control": "no-store",
        "X-Atlas-Lignes": String(r.lignes.length),
        "X-Atlas-Quota-Restant": String(res.reste - r.lignes.length),
        ...(coupe ? { "X-Atlas-Coupe-Quota": "1" } : {}),
      },
    });
  } catch (e) {
    if (e instanceof RefusExtraction) return NextResponse.json({ error: e.message, code: "quota_jour" }, { status: 429 });
    if (e instanceof seg.Introuvable) return NextResponse.json({ error: "segment introuvable" }, { status: 404 });
    if (e instanceof FiltreInvalide) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[atlas] export :", e);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
