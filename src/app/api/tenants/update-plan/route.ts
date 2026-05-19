/**
 * POST /api/tenants/update-plan — contrat §5.2.
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Comportement critique :
 *  - Si `plan_source = "stripe"` et plan actuel est lifetime_* / internal →
 *    409 plan_source_immutable. Stripe ne peut pas downgrade un plan offert.
 *  - Sinon : update + append dans veridian_plan_history.
 *
 * L'historique sert pour debug + admin panel Hub. Pas de cap dur côté DB
 * (cap soft 50 dernières lignes côté UI).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireHubHmac } from "@/lib/hub/auth";
import { prisma } from "@/lib/prisma";

type UpdatePlanBody = {
  tenant_id?: string;
  plan?: string;
  plan_source?: "stripe" | "manual" | "lifetime_site_vitrine" | "lifetime_partner" | "internal";
  reason?: string;
};

const ALLOWED_PLANS = new Set([
  "freemium",
  "starter",
  "pro",
  "enterprise",
  "lifetime_site_vitrine",
  "lifetime_partner",
  "internal",
]);

const ALLOWED_SOURCES = new Set([
  "stripe",
  "manual",
  "lifetime_site_vitrine",
  "lifetime_partner",
  "internal",
]);

const IMMUNE_PLAN_SOURCES = new Set([
  "lifetime_site_vitrine",
  "lifetime_partner",
  "internal",
]);

export async function POST(request: NextRequest) {
  const auth = await requireHubHmac<UpdatePlanBody>(request);
  if (!auth.ok) return auth.response;

  const { tenant_id, plan, plan_source = "stripe", reason } = auth.body;

  if (!tenant_id || !plan) {
    return NextResponse.json(
      { error: "invalid_payload", message: "tenant_id and plan are required" },
      { status: 400 },
    );
  }
  if (!ALLOWED_PLANS.has(plan)) {
    return NextResponse.json(
      {
        error: "invalid_plan",
        message: "plan not supported",
        details: { allowed_plans: [...ALLOWED_PLANS] },
      },
      { status: 400 },
    );
  }
  if (!ALLOWED_SOURCES.has(plan_source)) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "plan_source not supported",
        details: { allowed_sources: [...ALLOWED_SOURCES] },
      },
      { status: 400 },
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenant_id },
    select: { id: true, plan: true, planSource: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  // §3.3 — immunité plans offerts contre downgrade Stripe.
  if (
    plan_source === "stripe" &&
    tenant.planSource &&
    IMMUNE_PLAN_SOURCES.has(tenant.planSource)
  ) {
    return NextResponse.json(
      {
        error: "plan_source_immutable",
        message: "stripe cannot override a lifetime/internal plan",
        details: {
          current_plan: tenant.plan,
          current_plan_source: tenant.planSource,
        },
      },
      { status: 409 },
    );
  }

  const previousPlan = tenant.plan ?? null;
  const appliedAt = new Date();

  await prisma.tenant.update({
    where: { id: tenant_id },
    data: {
      plan,
      planSource: plan_source,
      planHistory: {
        create: {
          plan,
          planSource: plan_source,
          previousPlan,
          reason: reason ?? null,
          changedAt: appliedAt,
        },
      },
    },
  });

  console.log(
    `[update-plan] tenant=${tenant_id} plan=${previousPlan ?? "(none)"}→${plan} source=${plan_source}`,
  );

  return NextResponse.json({
    tenant_id,
    plan,
    previous_plan: previousPlan,
    applied_at: appliedAt.toISOString(),
  });
}
