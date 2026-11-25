/**
 * GET /api/atlas/rapport?segment_id=… ou ?id=… — rapport PDF d'un marché (src/atlas/rapport.ts). Session du navigateur, espace de la
 * session : un rapport d'un autre espace est introuvable. Que des comptes : tous les plans. 30 par heure et par utilisateur.
 */
import { NextRequest, NextResponse } from "next/server";

import { nomFichier } from "@/atlas/export";
import { avecClients } from "@/atlas/clients";
import { FiltreInvalide } from "@/atlas/filtres";
import { rapportPdf } from "@/atlas/rapport";
import { Introuvable } from "@/atlas/segments";
import { getUserContext } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refus = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return refus(401, "Unauthorized");
  const q = request.nextUrl.searchParams;
  const id = q.get("id"), segment = q.get("segment_id");
  if (!UUID.test(id ?? segment ?? "")) return refus(400, "id ou segment_id attendu");
  if (isRateLimited(`atlas-rapport:${ctx.userId}`, 30, 3_600_000)) return refus(429, "Trop de rapports cette heure (30 au plus).");
  try {
    const r = id ? await prisma.atlasRapport.findFirst({ where: { id, tenantId: ctx.tenantId } }) : null;
    if (id && !r) return refus(404, "rapport introuvable");
    const auteur = r ? (r.auteur.startsWith("ia:") ? `rédigé par ${r.auteur.slice(3)}` : null) : null;
    const { octets, nom } = await avecClients(ctx.tenantId, () =>
      rapportPdf(ctx.tenantId, r?.segmentId ?? segment!, { titre: r?.titre ?? "Rapport de marché", texte: r?.texte ?? "", auteur, date: r?.creeLe ?? new Date() }),
    );
    return new NextResponse(new Uint8Array(octets), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nomFichier(nom, "pdf")}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    if (e instanceof Introuvable) return refus(404, "marché introuvable");
    if (e instanceof FiltreInvalide) return refus(400, e.message);
    console.error("[atlas] rapport :", e);
    return refus(500, "Erreur interne");
  }
}
