import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { prisma } from "@/lib/prisma";
import { isGiftedPlan } from "@/lib/auth/tenant";

const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS ?? "7", 10);

/**
 * Plans qui n'ont PAS de trial / freemium UI. Tout user dont le tenant porte
 * un de ces plans reçoit `daysLeft=999 + isExpired=false`, ce qui désarme :
 *  - le badge "Essai gratuit — Xj" dans la nav (app-nav.tsx)
 *  - le composant Paywall / TrialGate (déclenché par `isExpired`)
 *  - le composant BlurredText (déclenché par `isExpired`)
 *
 * Source : audit trial résidus 2026-05-24 (ticket Hub
 * `2026-05-23-audit-trial-residus-apres-paiement.md`). Promesse Robert :
 * « client paie = aucun bandeau, aucun cap visible ».
 *
 * Couvre :
 *  - `pro`, `business` : tiers payants Stripe (CONTRAT-BILLING v2)
 *  - `enterprise` : tier legacy, mappé en `business` par update-plan mais
 *    encore présent sur des rows pré-migration v2 (défense en profondeur)
 *  - plans offerts (`lifetime_*`, `internal`) : immune au trial par contrat
 *    §3.3 — checke via `isGiftedPlan` pour rester aligné avec `tenant.ts`
 *  - `starter` : tier intermédiaire historique, payant
 */
const NON_TRIAL_PLANS = new Set([
  "pro",
  "business",
  "enterprise",
  "starter",
]);

function isPaidOrGiftedPlan(plan: string): boolean {
  return NON_TRIAL_PLANS.has(plan) || isGiftedPlan(plan);
}

// GET /api/trial — returns trial state based on user creation date + tenant plan.
// Source de vérité : Prisma User (createdAt) + Tenant (plan). Lookup tenant
// soit direct via userId (owner), soit via workspace_members → workspace.tenantId.
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { createdAt: true },
    });
    const createdAt = user?.createdAt ?? null;

    // Lookup tenant — owner direct puis fallback membre invité
    let tenant: { plan: string | null } | null = await prisma.tenant.findFirst({
      where: { userId: auth.user.id, deletedAt: null },
      select: { plan: true },
    });

    if (!tenant) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId: auth.user.id, deletedAt: null },
        include: { workspace: { select: { tenantId: true } } },
      });
      if (membership?.workspace?.tenantId) {
        tenant = await prisma.tenant.findFirst({
          where: { id: membership.workspace.tenantId, deletedAt: null },
          select: { plan: true },
        });
      }
    }

    const plan = tenant?.plan ?? "freemium";

    // Paid + gifted plans — aucune limite trial, aucun bandeau (cf
    // NON_TRIAL_PLANS + isGiftedPlan). Le client (trial-context.tsx) calcule
    // `isExpired: daysLeft <= 0` donc daysLeft=999 garantit qu'aucun overlay
    // ne se déclenche.
    if (isPaidOrGiftedPlan(plan)) {
      return NextResponse.json(
        { daysLeft: 999, plan, isExpired: false },
        { headers: { "Cache-Control": "private, max-age=300" } },
      );
    }

    if (!createdAt) {
      return NextResponse.json({ daysLeft: TRIAL_DAYS, plan, isExpired: false });
    }

    const elapsed = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const daysLeft = Math.max(0, Math.ceil(TRIAL_DAYS - elapsed));

    return NextResponse.json({ daysLeft, plan, isExpired: daysLeft <= 0 });
  } catch {
    // Fail-safe : si on n'arrive pas à résoudre le plan, on présume non-expiré
    // (jamais de paywall par panne — promesse Robert "pas de mur béton").
    return NextResponse.json({ daysLeft: TRIAL_DAYS, plan: "error", isExpired: false });
  }
}
