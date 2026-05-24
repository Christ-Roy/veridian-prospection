/**
 * POST /api/billing/refill-checkout — proxy refill leads vers le Hub.
 *
 * Le client clique "Payer" dans la modale refill (page /settings/leads).
 * Cette route :
 *   1. Vérifie que l'user est connecté ET membre du tenant ciblé (getUserContext).
 *   2. Valide la quantité (1 ≤ qty ≤ MAX_LEADS_PER_REFILL_ORDER).
 *   3. Sanity du prix attendu côté Prospection (informatif côté UI — la
 *      valeur faisant autorité est recalculée côté Hub à partir de tenant.plan).
 *   4. Appelle le Hub `POST /api/billing/refill-leads/checkout` via HMAC.
 *   5. Retourne `{ url, sessionId }` au client qui fera `window.location = url`.
 *
 * Réfère :
 *  - `veridian-hub/todo/done/2026-05-23-refill-leads-end-to-end.md` (contrat Hub)
 *  - `CONTRAT-BILLING.md` §8.4 (refill = flux séparé, Hub seul maître Stripe)
 *
 * Sécurité :
 *  - `requireUser()` — pas d'achat sans session valide.
 *  - Pas de cross-tenant : on n'achète que pour le tenant de l'user courant
 *    (jamais un tenantId fourni par le client).
 *  - Le prix sera RECALCULÉ par le Hub depuis tenant.plan + grille canonique —
 *    on ne fait que sanity-check ici pour bloquer un faux qty (négatif, etc.).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { createRefillCheckout } from "@/lib/hub/refill-client";
import {
  calculateRefillCostCents,
  MAX_LEADS_PER_REFILL_ORDER,
  type PlanId,
} from "@/lib/billing/plans";

const RefillCheckoutSchema = z.object({
  quantity: z
    .number()
    .int()
    .positive()
    .max(MAX_LEADS_PER_REFILL_ORDER),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

/** Mappe tenant.plan (texte DB) vers un PlanId refill (freemium|pro|business). */
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

  // Body parse + Zod. Le pattern `.catch(() => ({}))` Veridian standard évite
  // un crash si content-type pas JSON / body vide.
  const raw = await request.json().catch(() => ({}));
  const parsed = RefillCheckoutSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", message: parsed.error.message },
      { status: 422 },
    );
  }
  const { quantity, successUrl, cancelUrl } = parsed.data;

  // Lit le plan du tenant de l'user — sanity prix informatif. On ne BLOQUE pas
  // sur un mismatch (le Hub décidera) mais on logge si suspect.
  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { plan: true },
  });
  if (!tenant) {
    // L'user a une session mais son tenant n'existe plus — état impossible
    // après un purge propre. On bloque proprement.
    return NextResponse.json(
      { error: "tenant_not_found" },
      { status: 404 },
    );
  }

  const refillTier = mapTenantPlanToRefillTier(tenant.plan);
  let expectedCostCents = 0;
  try {
    expectedCostCents = calculateRefillCostCents(refillTier, quantity);
  } catch (err) {
    // calculateRefillCostCents throw au-delà du cap — déjà filtré par Zod
    // mais on remonte proprement par sécurité.
    return NextResponse.json(
      {
        error: "invalid_quantity",
        message: (err as Error).message,
      },
      { status: 422 },
    );
  }

  // Délègue au Hub. On lui passe tenantId (résolu par auth, pas confiance
  // client) + quantity. successUrl/cancelUrl optionnels — si absents, le Hub
  // applique ses defaults.
  const result = await createRefillCheckout({
    tenantId: ctx.tenantId,
    quantity,
    successUrl,
    cancelUrl,
  });

  if (!result.ok) {
    console.error(
      `[refill-checkout] hub call failed tenant=${ctx.tenantId} qty=${quantity} reason=${result.reason}`,
    );
    // 502 Bad Gateway pour les erreurs upstream Hub — distinct des 4xx user.
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
    `[refill-checkout] tenant=${ctx.tenantId} qty=${quantity} tier=${refillTier} expected=${expectedCostCents}c session=${result.sessionId}`,
  );

  return NextResponse.json({
    url: result.url,
    sessionId: result.sessionId,
    // Informatif — le client peut afficher "vous serez débité de X €" avant
    // redirect, mais c'est le Hub qui décide du montant final côté Stripe.
    expectedCostCents,
    quantity,
    refillTier,
  });
}
