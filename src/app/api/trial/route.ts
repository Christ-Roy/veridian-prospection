/**
 * GET /api/trial — plan de l'espace de l'utilisateur, en JSON. Témoin de la batterie système du Hub (cas 01 : plan
 * lisible à l'arrivée ; cas 05 : un plan posé au Hub se retrouve ici). Atlas n'a pas d'essai qui expire :
 * `isExpired` reste false. Jamais en cache : le cas 05 attend que la valeur change.
 * Retirée par erreur avec l'ancienne app le 15/11 (Next servait alors sa page 404 en HTML), rétablie le 23/11.
 */
import { NextResponse } from "next/server";

import { getUserContext } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const t = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { plan: true } });
  return NextResponse.json({ plan: t?.plan ?? "freemium", isExpired: false }, { headers: { "Cache-Control": "no-store" } });
}
