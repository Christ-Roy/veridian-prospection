/**
 * POST /api/refill/start — démarre un checkout Stripe refill ICP via le Hub.
 *
 * Pipeline :
 *  1. Auth session user → résoud tenantId du workspace
 *  2. Parse + valide body (quantity, filters?)
 *  3. Re-compte côté DB (sanity quantity ≤ estimated_count)
 *  4. HMAC vers Hub `/api/billing/refill-leads/checkout-from-app` (v2.1)
 *  5. Reçoit { url, sessionId } → renvoie à l'UI qui redirect
 *
 * Différence vs `POST /api/billing/refill-checkout` :
 *  - Cette route accepte `filters` (ICP) — propagés en metadata Stripe par
 *    le Hub puis re-injectés dans `credit-leads` au webhook.
 *  - Contract version 2.1 (vs 2.0 sans filtres).
 *
 * Pourquoi 2 routes Prosp côté refill :
 *  - `/api/billing/refill-checkout` (modale existante /settings/leads) :
 *    backward compat — pas de filtres, refill "tout-venant".
 *  - `/api/refill/start` (page native /leads/buy) : NOUVEAU — avec filtres
 *    ICP, contract v2.1.
 *  Les 2 cohabitent : on ne casse pas le flow modale tant qu'on a pas
 *  retiré la modale.
 *
 * Sécurité :
 *  - `requireUser` — pas de session, pas d'achat.
 *  - Pas de cross-tenant : on n'achète QUE pour le tenant de l'user courant
 *    (jamais un tenantId fourni par le client).
 *  - Rate-limit raisonnable (60 req/min/user — un user qui démarre 60 checkouts
 *    en 1 min = abnormal).
 *  - Re-compte serveur (anti-tampering) : si quantity > max_orderable selon
 *    les filtres, refuse 422. L'UI a fait son boulot côté preview mais on
 *    re-vérifie sans faire confiance.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { createRefillCheckoutFromApp } from "@/lib/hub/refill-from-app-client";
import { RefillIcpFiltersSchema, buildIcpWhereSql } from "@/lib/refill-icp/filters";
import {
  calculateRefillCostCents,
  MAX_LEADS_PER_REFILL_ORDER,
  type PlanId,
} from "@/lib/billing/plans";

const DEFAULT_WHERE = "e.is_registrar = false AND COALESCE(e.ca_suspect, false) = false";

const RefillStartSchema = z.object({
  quantity: z.number().int().positive().max(MAX_LEADS_PER_REFILL_ORDER),
  filters: RefillIcpFiltersSchema.optional(),
  successUrl: z.string().url().max(2048).optional(),
  cancelUrl: z.string().url().max(2048).optional(),
});

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

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  if (isRateLimited(`refill-start:${ctx.userId}`, 60, 60_000)) {
    return NextResponse.json(
      { error: "rate_limited", message: "Trop de tentatives. Réessayez dans une minute." },
      { status: 429 },
    );
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = RefillStartSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", message: parsed.error.message },
      { status: 422 },
    );
  }
  const { quantity, filters, successUrl, cancelUrl } = parsed.data;

  // Lit le plan du tenant — sanity prix + envoyé au Hub.
  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { plan: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  const refillTier = mapTenantPlanToRefillTier(tenant.plan);

  // Sanity prix Prosp (informatif — la valeur faisant autorité vient du Hub).
  let expectedCostCents = 0;
  try {
    expectedCostCents = calculateRefillCostCents(refillTier, quantity);
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_quantity", message: (err as Error).message },
      { status: 422 },
    );
  }

  // Re-compte serveur (anti-tampering filtres).
  // Si l'user a fait sauter le slider côté front pour commander 100k leads
  // dans un ICP qui n'en a que 250, on bloque ici. Le compte côté DB est la
  // source de vérité — la preview UI est juste un proxy.
  if (filters) {
    const { sql: filtersSql, params } = buildIcpWhereSql(filters, 1);
    try {
      const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM entreprises e WHERE ${DEFAULT_WHERE}${filtersSql}`,
        ...params,
      );
      const available = Number(rows[0]?.count ?? 0);
      if (quantity > available) {
        return NextResponse.json(
          {
            error: "quantity_exceeds_available",
            message: `Seulement ${available} leads matchent ces filtres (vous en avez demandé ${quantity}).`,
            available,
            requested: quantity,
          },
          { status: 422 },
        );
      }
    } catch (err) {
      console.error(
        `[refill/start] tenant=${ctx.tenantId} re-count SQL failed:`,
        err,
      );
      return NextResponse.json(
        { error: "db_error", message: "Échec de la validation des filtres." },
        { status: 503 },
      );
    }
  }

  // Délègue au Hub via HMAC v2.1.
  const result = await createRefillCheckoutFromApp({
    tenantId: ctx.tenantId,
    quantity,
    plan: refillTier,
    filters,
    successUrl,
    cancelUrl,
  });

  if (!result.ok) {
    console.error(
      `[refill/start] hub call failed tenant=${ctx.tenantId} qty=${quantity} reason=${result.reason}`,
    );
    const status =
      result.reason === "hub_misconfigured" || result.reason === "hub_unauthorized"
        ? 500
        : 502;
    return NextResponse.json(
      {
        error: "hub_unavailable",
        reason: result.reason,
        message:
          result.reason === "hub_misconfigured"
            ? "Le service de paiement n'est pas encore disponible."
            : "Le service de paiement est temporairement indisponible. Réessayez dans un instant.",
      },
      { status },
    );
  }

  console.log(
    `[refill/start] tenant=${ctx.tenantId} qty=${quantity} tier=${refillTier} ` +
      `expected=${expectedCostCents}c hub=${result.amountCents}c session=${result.sessionId}`,
  );

  return NextResponse.json({
    url: result.url,
    sessionId: result.sessionId,
    amountCents: result.amountCents,
    quantity: result.quantity,
    refillTier,
  });
}
