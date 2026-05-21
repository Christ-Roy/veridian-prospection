/**
 * Plans Veridian Prospection — source de vérité business model.
 *
 * ⚠️ Ce fichier est plan-as-code. Toute modification :
 *  1. Doit être commitée avec un commit business explicite (pas un "fix")
 *  2. Doit être répercutée côté Hub (Stripe products + matrice
 *     PROSPECTION_PLANS dans veridian-hub/lib/prospection/types.ts)
 *  3. Doit être documentée dans todo/2026-05-21-business-plan-pricing-features.md
 *
 * Modèle business — **2 flux de revenus distincts** :
 *
 *  FLUX 1 — Abonnement récurrent SaaS (l'app)
 *  Ce qu'on vend : accès à l'outil (CRM, recherche, pipeline, intégration
 *  newsletter Notifuse, scoring ICP, multi-membre seats, intégrations).
 *  Le quota leads n'est PAS lié à ce flux — voir flux 2.
 *
 *  FLUX 2 — Achat de leads à la commande (la data)
 *  Ce qu'on vend : import de lots de leads dans le workspace du tenant.
 *  Achat one-shot, prix dégressif selon quantité + selon plan.
 *  Une fois achetés, les leads restent dans le workspace pour toujours.
 *
 *  Bienvenue : à chaque souscription d'un plan payant, l'user reçoit
 *  un lot de leads offert pour démarrer / tester l'outil (welcomeLeads).
 *
 * Cadrage : sessions 2026-05-21 (Robert + agent Prospection).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

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
  /** Nombre max de seats (= workspace_members non-soft-deleted).
   *  null = illimité.
   *  Freemium : illimité — chaque invité devient un freemium séparé
   *  côté Hub (growth hack : un invité freemium déclenche son propre
   *  workspace freemium, multiplie l'acquisition virale). */
  maxSeats: number | null;
  /** Features débloquées par le plan. Voir FeatureFlag pour la liste. */
  features: FeatureFlag[];
  /** Tarif unitaire d'un lead refill quand on commande au-delà des
   *  welcomeLeads / leads déjà achetés. Prix dégressif par tranche
   *  défini dans LEAD_REFILL_PRICING. */
  refillTierKey: "freemium" | "pro" | "business";
}

/**
 * Features de l'app activables/désactivables par plan.
 * À étendre quand on précise le découpage feature → plan.
 */
export type FeatureFlag =
  // Recherche & exploration
  | "search_basic" // recherche par filtres simples (zone, secteur)
  | "search_advanced" // filtres INPI avancés (fraîcheur, growth, technique web)
  | "icp_scoring" // scoring ICP personnalisé par tenant
  // CRM / pipeline
  | "pipeline_basic" // statuts contacté / non contacté
  | "pipeline_advanced" // kanban, statuts custom, followups automatiques
  // Collaboration
  | "multi_seat" // inviter des membres (au-delà du growth hack freemium)
  | "workspace_unlimited" // créer plusieurs workspaces internes
  // Intégrations
  | "notifuse_sequences" // enrôler leads dans séquence email Notifuse
  | "csv_export" // export CSV des leads
  | "api_access" // clés API publiques pour intégrations tierces
  // Data
  | "verified_emails" // emails pro devinés + validés MX
  | "growth_signals"; // signaux croissance (recrutements, événements INPI)

// ─── Plans payants ──────────────────────────────────────────────────────────

export const PLANS: Record<PlanId, PlanDefinition> = {
  freemium: {
    id: "freemium",
    label: "Freemium",
    monthlyPriceEur: null,
    welcomeLeads: 100,
    maxSeats: null, // illimité — growth hack : chaque invité devient un freemium séparé
    features: [
      "search_basic",
      "pipeline_basic",
      "workspace_unlimited",
      // Pas de: csv_export, notifuse_sequences, icp_scoring, search_advanced,
      // verified_emails, multi_seat (= seats partagés sur le MÊME workspace),
      // api_access, pipeline_advanced, growth_signals
    ],
    refillTierKey: "freemium",
  },
  pro: {
    id: "pro",
    label: "Pro",
    // Prix arrêté 2026-05-21 (Robert) — 29€/mois HT, aligné Notifuse Pro pour
    // cohérence stack + palier psychologique d'entrée SaaS B2B français.
    // Annual : 290€/an (-17% = 2 mois offerts), à câbler côté Hub.
    monthlyPriceEur: 29,
    welcomeLeads: 2000,
    maxSeats: 5,
    features: [
      "search_basic",
      "search_advanced",
      "icp_scoring",
      "pipeline_basic",
      "pipeline_advanced",
      "multi_seat",
      "workspace_unlimited",
      "notifuse_sequences",
      "csv_export",
      "verified_emails",
      // Pas de: api_access, growth_signals (réservés Business)
    ],
    refillTierKey: "pro",
  },
  business: {
    id: "business",
    label: "Business",
    // Prix arrêté 2026-05-21 (Robert) — 89€/mois HT, palier sub-100€ accessible
    // PME 10-25 commerciaux, aligné Notifuse Business 99€ pour cohérence stack.
    // Annual : 890€/an (-17% = 2 mois offerts), à câbler côté Hub.
    monthlyPriceEur: 89,
    welcomeLeads: 8000,
    maxSeats: 25,
    features: [
      "search_basic",
      "search_advanced",
      "icp_scoring",
      "pipeline_basic",
      "pipeline_advanced",
      "multi_seat",
      "workspace_unlimited",
      "notifuse_sequences",
      "csv_export",
      "api_access",
      "verified_emails",
      "growth_signals",
    ],
    refillTierKey: "business",
  },
};

// ─── Plans offerts (gifted) ─────────────────────────────────────────────────

/**
 * Plans offerts §3.3 du contrat Hub. Quota illimité, jamais de feature
 * lockée, immune au downgrade Stripe (cf check plan_source côté
 * update-plan endpoint).
 *
 * Pas un produit Stripe — assigné manuellement par admin Hub.
 */
export const GIFTED_PLANS: GiftedPlanId[] = [
  "lifetime_site_vitrine", // client qui a pris un site vitrine Veridian
  "lifetime_partner", // partenaire revendeur
  "internal", // usage interne équipe Veridian
];

export function isGiftedPlan(plan: AnyPlanId): plan is GiftedPlanId {
  return (GIFTED_PLANS as string[]).includes(plan);
}

// ─── Lead refill — pricing à la commande ────────────────────────────────────

/**
 * Tranches de prix dégressif pour l'achat de lots de leads.
 *
 * Mécanique :
 *  - L'user commande un lot (ex: 500 leads filtrés "restaurateurs IDF 2026")
 *  - Le lot est ajouté à son workspace (pour toujours)
 *  - Le prix dépend de :
 *    a) son refillTierKey (freemium > pro > business, ratio coût décroissant)
 *    b) la tranche de quantité commandée (1 lead vs 10000 leads)
 *
 * Prix EN CENTIMES D'EURO pour éviter les arrondis flottants.
 *
 * ⚠️ Tarifs draft à CADRER en session pricing dédiée. Cf §4.2 du business doc.
 */
export interface RefillTier {
  minQuantity: number;
  /** Prix unitaire d'un lead dans cette tranche, en centimes d'euro. */
  pricePerLeadCents: number;
}

export const LEAD_REFILL_PRICING: Record<
  PlanDefinition["refillTierKey"],
  RefillTier[]
> = {
  // Pricing benchmark marché 2026 (Pharow, Kaspr, Apollo, Lusha, Cognism) :
  // lead enrichi B2B français = 0,05€-0,50€ selon niveau d'enrichissement.
  // Cible Veridian = "lead actionnable contact" (INPI + email vérifié + ICP)
  // = 0,15€-0,40€ moyen vendable.
  freemium: [
    // Freemium = prix plein, incentive fort à passer Pro
    { minQuantity: 1, pricePerLeadCents: 40 }, // 0,40€/lead
    { minQuantity: 100, pricePerLeadCents: 30 },
    { minQuantity: 1000, pricePerLeadCents: 20 },
  ],
  pro: [
    // Pro = -40% vs freemium en moyenne, aligné Apollo/Lusha milieu de gamme
    { minQuantity: 1, pricePerLeadCents: 25 },
    { minQuantity: 100, pricePerLeadCents: 20 },
    { minQuantity: 1000, pricePerLeadCents: 15 },
    { minQuantity: 10000, pricePerLeadCents: 10 },
  ],
  business: [
    // Business = -65% vs freemium en moyenne, compétitif vs data brokers gros volume
    { minQuantity: 1, pricePerLeadCents: 15 },
    { minQuantity: 100, pricePerLeadCents: 12 },
    { minQuantity: 1000, pricePerLeadCents: 8 },
    { minQuantity: 10000, pricePerLeadCents: 5 },
    { minQuantity: 50000, pricePerLeadCents: 3 },
  ],
};

/**
 * Cap de sécurité : maximum de leads commandables en une seule commande.
 * Évite l'achat accidentel ou la fraude. Refill au-delà = plusieurs
 * commandes ou demande commerciale.
 */
export const MAX_LEADS_PER_REFILL_ORDER = 100_000;

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
