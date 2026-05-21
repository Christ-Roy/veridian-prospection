/**
 * Tests src/lib/billing/plans.ts — plan-as-code business pricing.
 *
 * Garde-fous : ces tests bloquent toute régression du pricing arrêté
 * 2026-05-21 (Robert + agent). Toute modif de prix DOIT mettre à jour
 * ces assertions consciemment.
 */
import { describe, expect, test } from "vitest";
import {
  PLANS,
  GIFTED_PLANS,
  LEAD_REFILL_PRICING,
  MAX_LEADS_PER_REFILL_ORDER,
  calculateRefillCostCents,
  getRefillUnitPriceCents,
  hasFeature,
  isGiftedPlan,
  type PlanId,
} from "@/lib/billing/plans";

describe("PLANS — pricing arrêté 2026-05-21", () => {
  test("Freemium : gratuit, 100 welcome leads, seats illimités (growth hack)", () => {
    expect(PLANS.freemium.monthlyPriceEur).toBeNull();
    expect(PLANS.freemium.welcomeLeads).toBe(100);
    expect(PLANS.freemium.maxSeats).toBeNull();
  });

  test("Pro : 29€/mois, 2000 welcome leads, 5 seats", () => {
    expect(PLANS.pro.monthlyPriceEur).toBe(29);
    expect(PLANS.pro.welcomeLeads).toBe(2000);
    expect(PLANS.pro.maxSeats).toBe(5);
  });

  test("Business : 89€/mois, 8000 welcome leads, 25 seats", () => {
    expect(PLANS.business.monthlyPriceEur).toBe(89);
    expect(PLANS.business.welcomeLeads).toBe(8000);
    expect(PLANS.business.maxSeats).toBe(25);
  });

  test("Tous les plans déclarent un refillTierKey valide", () => {
    for (const planId of Object.keys(PLANS) as PlanId[]) {
      expect(LEAD_REFILL_PRICING[PLANS[planId].refillTierKey]).toBeDefined();
    }
  });
});

describe("Features par plan — découpage business", () => {
  test("Freemium : search_basic + pipeline_basic + workspace_unlimited uniquement", () => {
    expect(hasFeature("freemium", "search_basic")).toBe(true);
    expect(hasFeature("freemium", "pipeline_basic")).toBe(true);
    expect(hasFeature("freemium", "workspace_unlimited")).toBe(true);
    // Pas de :
    expect(hasFeature("freemium", "csv_export")).toBe(false);
    expect(hasFeature("freemium", "notifuse_sequences")).toBe(false);
    expect(hasFeature("freemium", "icp_scoring")).toBe(false);
    expect(hasFeature("freemium", "verified_emails")).toBe(false);
    expect(hasFeature("freemium", "api_access")).toBe(false);
    expect(hasFeature("freemium", "growth_signals")).toBe(false);
  });

  test("Pro : débloque CRM avancé + scoring ICP + emails vérifiés + Notifuse", () => {
    expect(hasFeature("pro", "icp_scoring")).toBe(true);
    expect(hasFeature("pro", "pipeline_advanced")).toBe(true);
    expect(hasFeature("pro", "verified_emails")).toBe(true);
    expect(hasFeature("pro", "notifuse_sequences")).toBe(true);
    expect(hasFeature("pro", "csv_export")).toBe(true);
    expect(hasFeature("pro", "multi_seat")).toBe(true);
    // Pas encore (réservé Business) :
    expect(hasFeature("pro", "api_access")).toBe(false);
    expect(hasFeature("pro", "growth_signals")).toBe(false);
  });

  test("Business : débloque tout (API, growth signals)", () => {
    expect(hasFeature("business", "api_access")).toBe(true);
    expect(hasFeature("business", "growth_signals")).toBe(true);
    expect(hasFeature("business", "icp_scoring")).toBe(true);
    expect(hasFeature("business", "verified_emails")).toBe(true);
  });

  test("Plans offerts (lifetime, internal) ont TOUTES les features", () => {
    for (const gifted of GIFTED_PLANS) {
      expect(hasFeature(gifted, "api_access")).toBe(true);
      expect(hasFeature(gifted, "growth_signals")).toBe(true);
      expect(hasFeature(gifted, "icp_scoring")).toBe(true);
    }
  });
});

describe("isGiftedPlan — détection plans offerts", () => {
  test("true pour lifetime_site_vitrine, lifetime_partner, internal", () => {
    expect(isGiftedPlan("lifetime_site_vitrine")).toBe(true);
    expect(isGiftedPlan("lifetime_partner")).toBe(true);
    expect(isGiftedPlan("internal")).toBe(true);
  });

  test("false pour freemium, pro, business", () => {
    expect(isGiftedPlan("freemium")).toBe(false);
    expect(isGiftedPlan("pro")).toBe(false);
    expect(isGiftedPlan("business")).toBe(false);
  });
});

describe("getRefillUnitPriceCents — prix dégressif", () => {
  test("Freemium 1 lead = 0,40€", () => {
    expect(getRefillUnitPriceCents("freemium", 1)).toBe(40);
  });

  test("Freemium 100 leads = 0,30€/lead (tranche 100+)", () => {
    expect(getRefillUnitPriceCents("freemium", 100)).toBe(30);
  });

  test("Freemium 1000 leads = 0,20€/lead (tranche max freemium)", () => {
    expect(getRefillUnitPriceCents("freemium", 1000)).toBe(20);
    expect(getRefillUnitPriceCents("freemium", 5000)).toBe(20);
  });

  test("Pro 10000 leads = 0,10€/lead (tranche max pro)", () => {
    expect(getRefillUnitPriceCents("pro", 10000)).toBe(10);
  });

  test("Business 50000 leads = 0,03€/lead (tranche max business)", () => {
    expect(getRefillUnitPriceCents("business", 50000)).toBe(3);
  });

  test("Plus le plan est haut, moins le lead coûte (à quantité égale)", () => {
    expect(getRefillUnitPriceCents("freemium", 1000)).toBeGreaterThan(
      getRefillUnitPriceCents("pro", 1000),
    );
    expect(getRefillUnitPriceCents("pro", 1000)).toBeGreaterThan(
      getRefillUnitPriceCents("business", 1000),
    );
  });
});

describe("calculateRefillCostCents — coût total commande", () => {
  test("Pro 500 leads = 500 × 20 cts = 10 000 cts (100€)", () => {
    // 500 dans la tranche [100, 1000[ → 20 cts/lead
    expect(calculateRefillCostCents("pro", 500)).toBe(500 * 20);
  });

  test("Business 25000 leads = 25000 × 5 cts = 125 000 cts (1250€)", () => {
    // 25000 dans la tranche [10000, 50000[ → 5 cts/lead
    expect(calculateRefillCostCents("business", 25000)).toBe(25000 * 5);
  });

  test("Quantity < 1 retourne 0 (no-op)", () => {
    expect(calculateRefillCostCents("pro", 0)).toBe(0);
    expect(calculateRefillCostCents("pro", -5)).toBe(0);
  });

  test("Quantity au-delà du cap MAX_LEADS_PER_REFILL_ORDER throw", () => {
    expect(() =>
      calculateRefillCostCents("business", MAX_LEADS_PER_REFILL_ORDER + 1),
    ).toThrow();
  });

  test("Pile au cap = OK (pas de off-by-one)", () => {
    expect(() =>
      calculateRefillCostCents("business", MAX_LEADS_PER_REFILL_ORDER),
    ).not.toThrow();
  });
});

describe("Cohérence ratio prix bundles cross-app (futur Hub)", () => {
  test("Pro standalone (29€) < Business standalone (89€)", () => {
    expect(PLANS.pro.monthlyPriceEur).toBeLessThan(
      PLANS.business.monthlyPriceEur!,
    );
  });

  test("Welcome leads Business (8000) = 4× Welcome Pro (2000) [garde-fou ratio]", () => {
    expect(PLANS.business.welcomeLeads).toBe(PLANS.pro.welcomeLeads * 4);
  });

  test("Welcome leads Pro (2000) = 20× Welcome Freemium (100) [garde-fou ratio]", () => {
    expect(PLANS.pro.welcomeLeads).toBe(PLANS.freemium.welcomeLeads * 20);
  });
});
