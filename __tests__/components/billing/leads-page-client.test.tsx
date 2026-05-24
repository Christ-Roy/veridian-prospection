/**
 * Tests source-level sur src/components/billing/leads-page-client.tsx.
 *
 * Garantit les invariants critiques :
 *  - polling 3s × 3 après ?refill=success (decision Robert)
 *  - fetch sur /api/me/leads-balance + /api/me/leads-events
 *  - solde affiché en gros, format français (toLocaleString fr-FR)
 *  - res.ok checké, fallback safe sur shape inattendu
 *  - URL nettoyée après handle (router.replace) pour éviter re-déclenche
 */
import { describe, expect, test } from "vitest";

describe("leads-page-client.tsx — invariants critiques", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(
        process.cwd(),
        "src/components/billing/leads-page-client.tsx",
      ),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test('export named "LeadsPageClient"', () => {
    expect(source).toMatch(/export function LeadsPageClient/);
  });

  test("fetch /api/me/leads-balance pour le solde", () => {
    expect(source).toMatch(/fetch\(\s*"\/api\/me\/leads-balance"\s*\)/);
  });

  test("fetch /api/me/leads-events?limit=... pour l'historique", () => {
    expect(source).toMatch(/fetch\(\s*"\/api\/me\/leads-events\?limit=/);
  });

  test("polling refresh post Stripe : interval = 3000ms, max 3 tentatives", () => {
    expect(source).toMatch(/POLL_INTERVAL_MS\s*=\s*3000/);
    expect(source).toMatch(/POLL_MAX_ATTEMPTS\s*=\s*3/);
  });

  test("détecte ?refill=success ET ?refill=cancel", () => {
    // success détecté par exclusion (`!== "success"` short-circuit) ou
    // explicite. cancel détecté explicitement.
    expect(source).toMatch(/refillStatus\s*(===|!==)\s*"success"/);
    expect(source).toMatch(/refillStatus\s*===\s*"cancel"/);
  });

  test("garde anti double-handle React Strict Mode (refillHandledRef)", () => {
    expect(source).toMatch(/refillHandledRef/);
    expect(source).toMatch(/if\s*\(\s*refillHandledRef\.current\s*\)\s*return/);
  });

  test("URL nettoyée via router.replace après handle ?refill=...", () => {
    expect(source).toMatch(/router\.replace\(\s*"\/settings\/leads"\s*\)/);
  });

  test("res.ok checké avant .json() (anti-crash défensif)", () => {
    expect(source).toMatch(/if\s*\(\s*!res\.ok\s*\)/);
  });

  test("guard Array.isArray sur events (sabotage-testable shape)", () => {
    expect(source).toMatch(/Array\.isArray\(\s*data\.events\s*\)/);
  });

  test("solde formaté en fr-FR (toLocaleString)", () => {
    expect(source).toMatch(/toLocaleString\(\s*"fr-FR"/);
  });

  test("data-testid pour E2E (balance-card, balance-value, events-table)", () => {
    expect(source).toMatch(/data-testid="leads-balance-card"/);
    expect(source).toMatch(/data-testid="leads-balance-value"/);
    expect(source).toMatch(/data-testid="leads-events-table"/);
  });

  test("RefillModal monté avec refillTier issu de l'API (pas hardcodé)", () => {
    expect(source).toMatch(/refillTier=\{\s*balance\.refillTier\s*\}/);
  });
});
