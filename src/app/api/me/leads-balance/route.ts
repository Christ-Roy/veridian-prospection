/**
 * GET /api/me/leads-balance — solde de leads du workspace actif de l'user.
 *
 * Lecture seule, scopée au workspace de l'user authentifié. Utilisée par :
 *  - le badge perma-visible dans la nav (`💎 <N>` leads)
 *  - le polling post-redirect Stripe sur /settings/leads (3s × 3) pour
 *    attraper le webhook Hub→Prospection qui a entre-temps incrémenté
 *    `leadsCredited`
 *
 * Retourne `{ credited, consumed, balance, refillTier, plan }`.
 * 401 si pas de session valide.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { getLeadBalance } from "@/lib/queries/lead-credits";
import type { PlanId } from "@/lib/billing/plans";

function mapTenantPlanToRefillTier(plan: string | null | undefined): PlanId {
  switch (plan) {
    case "pro":
      return "pro";
    case "business":
    case "enterprise":
    case "lifetime_site_vitrine":
    case "lifetime_partner":
    case "internal":
      return "business";
    case "freemium":
    case "starter":
    case "geo":
    case "full":
    default:
      return "freemium";
  }
}

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  // Workspace actif = celui que le user voit (cookie). Si pas résolu (user
  // sans workspace = état dégradé), retourne 0 plutôt que 401 — la nav doit
  // toujours pouvoir s'afficher.
  const workspaceId = ctx.activeWorkspaceId ?? ctx.workspaces[0]?.id ?? null;
  const balance = await getLeadBalance(workspaceId);

  // Récupère le plan local du tenant pour que le client affiche le bon tarif
  // refill dans la modale (tarif dégressif dépend du plan).
  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { plan: true },
  });
  const plan = tenant?.plan ?? "freemium";
  const refillTier = mapTenantPlanToRefillTier(plan);

  return NextResponse.json({
    credited: balance.credited,
    consumed: balance.consumed,
    balance: balance.balance,
    plan,
    refillTier,
  });
}
