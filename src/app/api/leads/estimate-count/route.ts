/**
 * POST /api/leads/estimate-count — preview live du nombre de leads matchant
 * une configuration ICP (refill UI native, ticket refill ICP page native).
 *
 * Appelée DEBOUNCED 300ms par `LiveCountPreview.tsx` à chaque modif de filtre.
 *
 * Sécurité :
 *  - Auth session user (`requireUser`) — pas d'access anonyme.
 *  - Rate-limit 30 req/min/user — la requête tape la base entreprises 996k
 *    rows (COUNT avec WHERE multiple). Debounce front + rate-limit back =
 *    protection N+1 / DoS sur compute coûteux.
 *  - Body validé via RefillIcpFiltersSchema — strict (rejette les champs
 *    inconnus), bornes numériques anti-overflow.
 *  - PAS d'exposition des leads — on retourne juste un COUNT(*). Le user
 *    devra payer pour matérialiser le lot (anti-scraping).
 *
 * Response :
 *   { estimated_count: number, plan_cap: number, max_orderable: number,
 *     unit_price_cents: number, tier: 'freemium'|'pro'|'business' }
 *
 *  - estimated_count : COUNT(*) côté entreprises (filtrés par les filters
 *    + DEFAULT_ENTREPRISES_WHERE — exclut registrars + ca_suspect).
 *  - plan_cap : MAX_LEADS_PER_REFILL_ORDER (100k, cf shared/pricing/refill).
 *  - max_orderable : min(estimated_count, plan_cap) — borne haute du
 *    slider quantité côté UI.
 *  - unit_price_cents / tier : informatif pour l'UI (1 round-trip = preview
 *    count + grille de prix). La grille canonique vit dans plans.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { RefillIcpFiltersSchema, buildIcpWhereSql } from "@/lib/refill-icp/filters";
import {
  MAX_LEADS_PER_REFILL_ORDER,
  getRefillUnitPriceCents,
  type PlanId,
} from "@/lib/billing/plans";

/** DEFAULT_ENTREPRISES_WHERE — recopié pour ne pas créer de dépendance circulaire vers shared.ts */
const DEFAULT_WHERE = "e.is_registrar = false AND COALESCE(e.ca_suspect, false) = false";

/** Mapping tenant.plan (texte DB) vers PlanId refill — aligné sur refill-checkout. */
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

  // Rate-limit par user — debounce front + 30/min back = couvre les usages
  // normaux (un slider tweak = ~1-3 req) sans risque de saturation DB.
  if (isRateLimited(`estimate-count:${ctx.userId}`, 30, 60_000)) {
    return NextResponse.json(
      { error: "rate_limited", message: "Trop de requêtes. Réessayez dans une minute." },
      { status: 429 },
    );
  }

  // Pattern Veridian classique : safe parse body — content-type pas JSON
  // / body vide → object vide → Zod fail proprement avec invalid_body.
  const raw = await request.json().catch(() => ({}));
  const parsed = RefillIcpFiltersSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", message: parsed.error.message },
      { status: 422 },
    );
  }
  const filters = parsed.data;

  // Build WHERE — pure, pas d'accès DB.
  const { sql: filtersSql, params } = buildIcpWhereSql(filters, 1);

  // Lit le plan tenant pour la grille de prix preview.
  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { plan: true },
  });
  const tier = mapTenantPlanToRefillTier(tenant?.plan);

  // COUNT — paramétré strictement.
  // On utilise $queryRawUnsafe parce que filtersSql contient des `$N`
  // positionnels que Postgres bindera avec `params`. Le SQL lui-même est
  // entièrement statique (DEFAULT_WHERE + filtersSql buildé par notre helper
  // qui n'interpole AUCUNE valeur user).
  let count = 0;
  try {
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM entreprises e WHERE ${DEFAULT_WHERE}${filtersSql}`,
      ...params,
    );
    count = Number(rows[0]?.count ?? 0);
  } catch (err) {
    console.error(
      `[estimate-count] tenant=${ctx.tenantId} user=${ctx.userId} SQL failed:`,
      err,
    );
    return NextResponse.json(
      { error: "db_error", message: "Échec du comptage. Réessayez." },
      { status: 503 },
    );
  }

  const maxOrderable = Math.min(count, MAX_LEADS_PER_REFILL_ORDER);
  // Prix unitaire indicatif sur 1 lead — l'UI re-calcule le prix total live
  // depuis la grille complète via calculateRefillCostCents.
  const unitPriceCents = getRefillUnitPriceCents(tier, Math.max(1, maxOrderable));

  return NextResponse.json({
    estimated_count: count,
    plan_cap: MAX_LEADS_PER_REFILL_ORDER,
    max_orderable: maxOrderable,
    unit_price_cents: unitPriceCents,
    tier,
  });
}
