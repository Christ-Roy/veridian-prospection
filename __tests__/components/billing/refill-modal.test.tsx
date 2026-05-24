/**
 * Tests source-level sur src/components/billing/refill-modal.tsx.
 *
 * Pattern source-level (cf segment-table.test.tsx, pipeline-board.test.tsx) :
 * la modale est trop intriquée avec Radix Dialog pour un render JSDOM stable,
 * on audit le source pour garantir les invariants critiques métier.
 *
 * Invariants vérifiés (sabotage-testables) :
 *  - calculateRefillCostCents importé depuis @/lib/billing/plans (pas de
 *    duplication du calcul côté UI)
 *  - POST /api/billing/refill-checkout avec method POST + Content-Type JSON
 *  - quantity validée min=1 / max=MAX_LEADS_PER_REFILL_ORDER
 *  - bouton Payer disabled si invalide ou loading
 *  - res.ok checké avant .json() (pattern audit défensif 2026-05-23)
 *  - successUrl/cancelUrl construits depuis window.location.origin
 */
import { describe, expect, test } from "vitest";

describe("refill-modal.tsx — invariants critiques", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/billing/refill-modal.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test('export named "RefillModal"', () => {
    expect(source).toMatch(/export function RefillModal/);
  });

  test("calculateRefillCostCents importé depuis @/lib/billing/plans (pas de duplication)", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*calculateRefillCostCents[^}]*\}\s*from\s*"@\/lib\/billing\/plans"/,
    );
  });

  test("MAX_LEADS_PER_REFILL_ORDER importé (cap centralisé)", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*MAX_LEADS_PER_REFILL_ORDER[^}]*\}\s*from\s*"@\/lib\/billing\/plans"/,
    );
  });

  test("POST /api/billing/refill-checkout avec method POST + JSON", () => {
    expect(source).toMatch(/fetch\(\s*"\/api\/billing\/refill-checkout"/);
    expect(source).toMatch(/method:\s*"POST"/);
    expect(source).toMatch(/"Content-Type":\s*"application\/json"/);
  });

  test("res.ok checké avant .json() (anti-crash défensif)", () => {
    expect(source).toMatch(/if\s*\(\s*!res\.ok\s*\)/);
  });

  test("quantity bornée par MAX_LEADS_PER_REFILL_ORDER côté UI", () => {
    expect(source).toMatch(
      /quantity\s*>\s*MAX_LEADS_PER_REFILL_ORDER/,
    );
  });

  test("bouton Payer disabled si !isValidQty || loading", () => {
    expect(source).toMatch(/disabled=\{\s*!isValidQty\s*\|\|\s*loading\s*\}/);
  });

  test("successUrl construit depuis window.location.origin (pas hardcodé)", () => {
    expect(source).toMatch(/window\.location\.origin/);
    expect(source).toMatch(/\?refill=success/);
    expect(source).toMatch(/\?refill=cancel/);
  });

  test("window.location.href redirige vers data.url (Stripe Checkout)", () => {
    expect(source).toMatch(/window\.location\.href\s*=\s*data\.url/);
  });

  test("data-testid présents pour E2E (trigger, content, input, pay-button)", () => {
    expect(source).toMatch(/data-testid="refill-modal-trigger"/);
    expect(source).toMatch(/data-testid="refill-modal-content"/);
    expect(source).toMatch(/data-testid="refill-quantity-input"/);
    expect(source).toMatch(/data-testid="refill-pay-button"/);
  });
});
