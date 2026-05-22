/**
 * POST /api/tenants/update-plan — CONTRAT-BILLING.md v2 §3.
 *
 * Consumer du payload `update-plan` v2 émis par le Hub. Auth : HMAC Hub
 * (Pattern A, CONTRAT-HUB.md §6.1).
 *
 * Le Hub est le SEUL interlocuteur Stripe (§2). Cet endpoint applique le
 * changement de plan poussé — il ne parle jamais à Stripe, ne reçoit jamais
 * de webhook Stripe.
 *
 * Invariants v2 appliqués (§3.4) :
 *  1. Versioning — rejet 400 si `contract_version` major ≠ 2.
 *  2. Enum `plan` fermé — `free | pro | business | enterprise`. Hors enum
 *     → 400. `plan` est mappé vers le nom LOCAL Prospection avant persistance
 *     (`free → freemium`, `enterprise → business` + warn — §3.2bis).
 *  3. Enum `plan_source` — `stripe | stripe_trial | grant_manual |
 *     downgrade_auto`. `stripe_trial` distinct de `stripe` (§7.2).
 *  4. Idempotence — dédoublonnage sur `idempotency_key` (unique sur
 *     `veridian_plan_history`). Replay = 200 no-op.
 *  5. Plan offert immune — un tenant `plan_source` offert (`grant_manual`
 *     ou legacy `lifetime_*` / `internal`) n'est PAS downgradé par un
 *     `update-plan` Stripe / downgrade_auto → 409 plan_source_immutable.
 *     Seul un `update-plan plan_source=grant_manual` peut tout écraser.
 *  6. Fail-open — aucun downgrade par silence ici (cf §4 ; ce handler
 *     n'agit que sur un signal Hub explicite).
 *
 * L'historique `veridian_plan_history` sert debug + admin panel Hub. Pas de
 * cap dur côté DB (cap soft 50 dernières lignes côté UI).
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireHubHmac } from "@/lib/hub/auth";
import { prisma } from "@/lib/prisma";
import {
  CANONICAL_PLANS_V2,
  PLAN_SOURCES_V2,
  isCanonicalPlan,
  isPlanSourceV2,
  mapCanonicalPlanToLocal,
  type PlanSourceV2,
} from "@/lib/billing/plans";

/** Major du contrat billing supporté par ce consumer. */
const SUPPORTED_CONTRACT_MAJOR = 2;

/**
 * `plan_source` qui rendent un tenant immune au downgrade Stripe.
 *
 * `grant_manual` est la valeur v2 canonique. Les valeurs `lifetime_*` /
 * `internal` sont des `planSource` legacy v1 encore présents en DB sur des
 * rows non migrées — on les traite comme immunes par défense en profondeur.
 */
const IMMUNE_PLAN_SOURCES = new Set<string>([
  "grant_manual",
  // legacy v1 — rows pré-migration contrat v2
  "lifetime_site_vitrine",
  "lifetime_partner",
  "internal",
]);

type UpdatePlanBody = {
  contract_version?: string;
  tenant_id?: string;
  plan?: string;
  plan_source?: string;
  effective_at?: string;
  stripe_subscription_id?: string | null;
  idempotency_key?: string;
  reason?: string;
};

/** Extrait le major d'une string de version (`"2.0"` → `2`, `"2"` → `2`). */
function parseMajor(version: string): number | null {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

export async function POST(request: NextRequest) {
  const auth = await requireHubHmac<UpdatePlanBody>(request);
  if (!auth.ok) return auth.response;

  const {
    contract_version,
    tenant_id,
    plan,
    plan_source,
    idempotency_key,
    reason,
  } = auth.body;

  // ── Invariant 1 — versioning (§3.4.1) ────────────────────────────────────
  // `contract_version` est un champ figé du payload v2 (§3.2). Absent OU
  // major inconnu → 400 : un major bump est un breaking change explicite,
  // jamais deviné.
  if (!contract_version) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "contract_version is required",
      },
      { status: 400 },
    );
  }
  const major = parseMajor(contract_version);
  if (major !== SUPPORTED_CONTRACT_MAJOR) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: `unsupported contract_version major (got "${contract_version}", expected ${SUPPORTED_CONTRACT_MAJOR}.x)`,
        details: { supported_major: SUPPORTED_CONTRACT_MAJOR },
      },
      { status: 400 },
    );
  }

  // ── Champs requis ────────────────────────────────────────────────────────
  if (!tenant_id || !plan) {
    return NextResponse.json(
      { error: "invalid_payload", message: "tenant_id and plan are required" },
      { status: 400 },
    );
  }
  if (!idempotency_key) {
    return NextResponse.json(
      { error: "invalid_payload", message: "idempotency_key is required" },
      { status: 400 },
    );
  }

  // ── Invariant 2 — enum `plan` fermé (§3.4.2) ─────────────────────────────
  if (!isCanonicalPlan(plan)) {
    return NextResponse.json(
      {
        error: "invalid_plan",
        message: "plan not supported",
        details: { allowed_plans: [...CANONICAL_PLANS_V2] },
      },
      { status: 400 },
    );
  }

  // ── Invariant 3 — enum `plan_source` v2 (§3.3) ───────────────────────────
  // Default `stripe` : le payload v2 le porte toujours, mais on reste tolérant
  // pour un éventuel émetteur qui l'omettrait sur un changement Stripe.
  const sourceRaw: string = plan_source ?? "stripe";
  if (!isPlanSourceV2(sourceRaw)) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "plan_source not supported",
        details: { allowed_sources: [...PLAN_SOURCES_V2] },
      },
      { status: 400 },
    );
  }
  const planSource: PlanSourceV2 = sourceRaw;

  // ── Mapping canonique → nom local (§3.2bis) ──────────────────────────────
  // La DB et ses consommateurs (lead-quota, PLAN_LIMITS) raisonnent en noms
  // locaux : on persiste le nom LOCAL, jamais l'enum canonique du fil.
  const { localPlan, enterpriseDowngraded } = mapCanonicalPlanToLocal(plan);
  if (enterpriseDowngraded) {
    console.warn(
      `[update-plan] tenant=${tenant_id} reçu plan=enterprise — Prospection n'a pas ce tier, traité comme "business" (CONTRAT-BILLING §3.2bis)`,
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenant_id },
    select: { id: true, plan: true, planSource: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  // ── Invariant 5 — immunité des plans offerts (§3.4.4) ────────────────────
  // Un tenant offert ne se fait pas downgrader par un signal Stripe /
  // downgrade_auto. Seul un `update-plan plan_source=grant_manual` (action
  // admin Hub) peut écraser n'importe quel état.
  if (
    planSource !== "grant_manual" &&
    tenant.planSource &&
    IMMUNE_PLAN_SOURCES.has(tenant.planSource)
  ) {
    return NextResponse.json(
      {
        error: "plan_source_immutable",
        message:
          "a granted (lifetime/internal) plan cannot be overridden by a Stripe-driven update",
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

  // ── Invariant 4 — idempotence (§3.4.3) ───────────────────────────────────
  // L'index unique sur `veridian_plan_history.idempotency_key` est le garde.
  // Un replay du même key viole la contrainte (Prisma P2002) → on relit
  // l'état courant et on renvoie un 200 no-op (§3.6 : 200 recommandé).
  try {
    await prisma.tenant.update({
      where: { id: tenant_id },
      data: {
        plan: localPlan,
        planSource,
        planHistory: {
          create: {
            plan: localPlan,
            planSource,
            previousPlan,
            reason: reason ?? null,
            idempotencyKey: idempotency_key,
            changedAt: appliedAt,
          },
        },
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Replay du même `idempotency_key` — no-op. On renvoie l'état déjà
      // appliqué tel qu'il est en DB.
      const current = await prisma.tenant.findUnique({
        where: { id: tenant_id },
        select: { plan: true, planSource: true },
      });
      console.log(
        `[update-plan] tenant=${tenant_id} idempotency_key=${idempotency_key} replay — no-op`,
      );
      return NextResponse.json({
        tenant_id,
        plan: current?.plan ?? localPlan,
        previous_plan: previousPlan,
        plan_source: current?.planSource ?? planSource,
        applied_at: appliedAt.toISOString(),
        idempotent_replay: true,
      });
    }
    throw err;
  }

  console.log(
    `[update-plan] tenant=${tenant_id} plan=${previousPlan ?? "(none)"}→${localPlan} source=${planSource} key=${idempotency_key}`,
  );

  return NextResponse.json({
    tenant_id,
    plan: localPlan,
    previous_plan: previousPlan,
    plan_source: planSource,
    applied_at: appliedAt.toISOString(),
  });
}
