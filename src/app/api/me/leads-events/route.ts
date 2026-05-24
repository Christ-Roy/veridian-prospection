/**
 * GET /api/me/leads-events — historique des crédits leads du workspace actif.
 *
 * Retourne les N derniers événements de la table `lead_credit_events`
 * (purchase + welcome) pour le workspace de l'user authentifié, triés par
 * date desc. Utilisé par la page /settings/leads pour la table d'historique.
 *
 * Query params :
 *  - `limit` : 1..100 (default 50)
 *
 * Note : on ne joint pas les "consumed" events (table `lead_consumption`)
 * pour rester lisible — la page sépare visuellement "Crédits" vs "Consos".
 * Si Robert veut un mix chrono unifié plus tard, c'est un autre endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : DEFAULT_LIMIT;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const workspaceId = ctx.activeWorkspaceId ?? ctx.workspaces[0]?.id ?? null;
  if (!workspaceId) {
    return NextResponse.json({ events: [], total: 0 });
  }

  const events = await prisma.leadCreditEvent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      quantity: true,
      source: true,
      welcomePlan: true,
      stripePaymentId: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      quantity: e.quantity,
      source: e.source,
      welcomePlan: e.welcomePlan,
      stripePaymentId: e.stripePaymentId,
      createdAt: e.createdAt.toISOString(),
    })),
    total: events.length,
  });
}
