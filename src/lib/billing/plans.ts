/**
 * Plans Veridian Prospection — ADAPTATEUR vers @veridian/shared.
 *
 * 🔥 Source de vérité numérique : `shared/shared/pricing/plans.ts` du submodule
 * `veridian-infra` (canonique cross-app aligné PRICING-VERIDIAN.md v1.1).
 *
 * Ce fichier conserve le shape historique Prospection (PlanId = "freemium" |
 * "pro" | "business", PlanDefinition avec monthlyPriceEur / welcomeLeads /
 * refillTierKey / features FeatureFlag[]) pour ne pas casser :
 *  - la DB Postgres (colonnes `plan` de tenants)
 *  - les consommateurs existants côté Prospection
 *  - les imports des tests `__tests__/lib/billing/plans.test.ts`
 *
 * Quand le pricing bouge :
 *  1. Modif côté `veridian-infra/shared/pricing/plans.ts` (source de vérité)
 *  2. Commit + push veridian-infra
 *  3. Bump du submodule Prosp : `git submodule update --remote shared`
 *  4. Si nouvelle feature dans le shared : étendre `FeatureFlag` + mapping
 *
 * Modèle business — **2 flux de revenus distincts** :
 *
 *  FLUX 1 — Abonnement récurrent SaaS (l'app)
 *  Ce qu'on vend : accès à l'outil (CRM, recherche, pipeline, intégration
 *  newsletter Notifuse, scoring ICP, multi-membre seats, intégrations).
 *
 *  FLUX 2 — Achat de leads à la commande (la data)
 *  Ce qu'on vend : import de lots de leads dans le workspace du tenant.
 *  Achat one-shot, prix dégressif selon quantité + selon plan.
 *
 *  Bienvenue : à chaque souscription d'un plan, l'user reçoit un lot de
 *  leads offert (welcomeLeads).
 */

import {
  PLANS as CANONICAL_PLANS,
  LEAD_REFILL_PRICING_CENTS as CANONICAL_REFILL,
  MAX_LEADS_PER_REFILL_ORDER as CANONICAL_MAX_REFILL,
  type FeatureKey,
} from "@veridian/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

/** PlanId Prospection — aligné DB. Mapping vers canonique géré ci-dessous. */
export type PlanId = "freemium" | "pro" | "business";

export type GiftedPlanId =
  | "lifetime_site_vitrine"
  | "lifetime_partner"
  | "internal";

export type AnyPlanId = PlanId | GiftedPlanId;

export interface PlanDefinition {
  id: PlanId;
  label: string;
  /** Prix de l'abonnement SaaS récurrent. Null pour freemium. */
  monthlyPriceEur: number | null;
  /** Lot de leads OFFERT one-shot à la souscription (pas mensuel). */
  welcomeLeads: number;
  /** Nombre max de seats. null = illimité (growth hack freemium). */
  maxSeats: number | null;
  /** Features débloquées par le plan. */
  features: FeatureFlag[];
  /** Refill tier key — détermine la grille de prix refill. */
  refillTierKey: "freemium" | "pro" | "business";
}

/**
 * Features de l'app activables/désactivables par plan.
 * Mapping 1-pour-1 avec FeatureKey côté @veridian/shared.
 */
export type FeatureFlag =
  // Recherche & exploration
  | "search_basic"
  | "search_advanced"
  | "icp_scoring"
  // CRM / pipeline
  | "pipeline_basic"
  | "pipeline_advanced"
  // Collaboration
  | "multi_seat"
  | "workspace_unlimited"
  // Intégrations
  | "notifuse_sequences"
  | "csv_export"
  | "api_access"
  // Data
  | "verified_emails"
  | "growth_signals";

// ─── Mapping FeatureKey (shared) ↔ FeatureFlag (Prospection) ────────────────

const FEATURE_MAP: Record<FeatureFlag, FeatureKey> = {
  search_basic: "prospection_search_basic",
  search_advanced: "prospection_search_advanced",
  icp_scoring: "prospection_icp_scoring",
  pipeline_basic: "prospection_pipeline_basic",
  pipeline_advanced: "prospection_pipeline_advanced",
  multi_seat: "prospection_multi_seat",
  workspace_unlimited: "prospection_workspace_unlimited",
  notifuse_sequences: "prospection_notifuse_sequences",
  csv_export: "prospection_csv_export",
  api_access: "prospection_api_access",
  verified_emails: "prospection_verified_emails",
  growth_signals: "prospection_growth_signals",
};

/** Retourne les FeatureFlag du canonique mappées vers les flags locaux. */
function extractFeatureFlags(canonicalFeatures: readonly FeatureKey[]): FeatureFlag[] {
  const flags: FeatureFlag[] = [];
  for (const [localFlag, canonicalKey] of Object.entries(FEATURE_MAP) as Array<
    [FeatureFlag, FeatureKey]
  >) {
    if (canonicalFeatures.includes(canonicalKey)) {
      flags.push(localFlag);
    }
  }
  return flags;
}

// ─── Plans payants (re-shape depuis @veridian/shared) ───────────────────────

const FREEMIUM_CANONICAL = CANONICAL_PLANS["prospection-free"];
const PRO_CANONICAL = CANONICAL_PLANS["prospection-pro"];
const BUSINESS_CANONICAL = CANONICAL_PLANS["prospection-business"];

export const PLANS: Record<PlanId, PlanDefinition> = {
  freemium: {
    id: "freemium",
    label: "Freemium",
    monthlyPriceEur: FREEMIUM_CANONICAL.price_eur === 0 ? null : FREEMIUM_CANONICAL.price_eur,
    welcomeLeads: FREEMIUM_CANONICAL.welcome_leads,
    maxSeats: FREEMIUM_CANONICAL.seats, // null = illimité
    features: extractFeatureFlags(FREEMIUM_CANONICAL.features),
    refillTierKey: "freemium",
  },
  pro: {
    id: "pro",
    label: "Pro",
    monthlyPriceEur: PRO_CANONICAL.price_eur,
    welcomeLeads: PRO_CANONICAL.welcome_leads,
    maxSeats: PRO_CANONICAL.seats,
    features: extractFeatureFlags(PRO_CANONICAL.features),
    refillTierKey: "pro",
  },
  business: {
    id: "business",
    label: "Business",
    monthlyPriceEur: BUSINESS_CANONICAL.price_eur,
    welcomeLeads: BUSINESS_CANONICAL.welcome_leads,
    maxSeats: BUSINESS_CANONICAL.seats,
    features: extractFeatureFlags(BUSINESS_CANONICAL.features),
    refillTierKey: "business",
  },
};

// ─── Plans offerts (gifted) ─────────────────────────────────────────────────

/**
 * Plans offerts §3.3 du contrat Hub. Quota illimité, immune au downgrade
 * Stripe. Assigné manuellement par admin Hub.
 */
export const GIFTED_PLANS: GiftedPlanId[] = [
  "lifetime_site_vitrine",
  "lifetime_partner",
  "internal",
];

export function isGiftedPlan(plan: AnyPlanId): plan is GiftedPlanId {
  return (GIFTED_PLANS as string[]).includes(plan);
}

// ─── Lead refill — pricing à la commande ────────────────────────────────────

/** Tranches de prix dégressif pour l'achat de lots de leads (centimes EUR). */
export interface RefillTier {
  minQuantity: number;
  pricePerLeadCents: number;
}

/**
 * Tranches de pricing refill, projetées depuis le canonique
 * `LEAD_REFILL_PRICING_CENTS` de @veridian/shared.
 *
 * Le shape canonique a `{ min, max, perLead }` ; le shape Prospection
 * historique a `{ minQuantity, pricePerLeadCents }`. Conversion ci-dessous.
 */
export const LEAD_REFILL_PRICING: Record<
  PlanDefinition["refillTierKey"],
  RefillTier[]
> = {
  freemium: CANONICAL_REFILL.freemium.map((t) => ({
    minQuantity: t.min,
    pricePerLeadCents: t.perLead,
  })),
  pro: CANONICAL_REFILL.pro.map((t) => ({
    minQuantity: t.min,
    pricePerLeadCents: t.perLead,
  })),
  business: CANONICAL_REFILL.business.map((t) => ({
    minQuantity: t.min,
    pricePerLeadCents: t.perLead,
  })),
};

/**
 * Cap de sécurité maximum leads par commande.
 * Synchronisé sur le canonique pour cohérence cross-app.
 */
export const MAX_LEADS_PER_REFILL_ORDER = CANONICAL_MAX_REFILL;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Retourne le tarif unitaire centimes pour une commande donnée. */
export function getRefillUnitPriceCents(
  planId: PlanId,
  quantity: number,
): number {
  const plan = PLANS[planId];
  const tiers = LEAD_REFILL_PRICING[plan.refillTierKey];
  // Trouve la tranche la plus haute applicable
  let applicable = tiers[0];
  for (const tier of tiers) {
    if (quantity >= tier.minQuantity) applicable = tier;
  }
  return applicable.pricePerLeadCents;
}

/** Coût total en centimes d'une commande de leads. */
export function calculateRefillCostCents(
  planId: PlanId,
  quantity: number,
): number {
  if (quantity < 1) return 0;
  if (quantity > MAX_LEADS_PER_REFILL_ORDER) {
    throw new Error(
      `quantity ${quantity} dépasse MAX_LEADS_PER_REFILL_ORDER (${MAX_LEADS_PER_REFILL_ORDER})`,
    );
  }
  return getRefillUnitPriceCents(planId, quantity) * quantity;
}

/** Check si un plan débloque une feature. */
export function hasFeature(planId: AnyPlanId, feature: FeatureFlag): boolean {
  if (isGiftedPlan(planId)) return true; // gifted = tout débloqué
  return PLANS[planId].features.includes(feature);
}
