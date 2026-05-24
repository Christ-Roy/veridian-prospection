/**
 * Tests source-level sur src/components/dashboard/leads-balance-badge.tsx.
 *
 * Le badge est rendu dans toutes les pages dashboard — il doit JAMAIS crasher
 * et JAMAIS bloquer le rendu de la nav. Audit défensif.
 *
 * Invariants vérifiés :
 *  - fetch /api/me/leads-balance avec res.ok checké
 *  - try/catch enveloppant pour ne jamais propager une erreur réseau
 *  - polling 60s léger (informatif, pas temps réel)
 *  - couleurs : red si vide, red-light si < 10, amber si < 50, neutre sinon
 *  - return null si pas de balance chargée (pas de placeholder bruyant)
 *  - cliquable → /settings/leads
 */
import { describe, expect, test } from "vitest";

describe("leads-balance-badge.tsx — invariants critiques", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(
        process.cwd(),
        "src/components/dashboard/leads-balance-badge.tsx",
      ),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test('export named "LeadsBalanceBadge"', () => {
    expect(source).toMatch(/export function LeadsBalanceBadge/);
  });

  test("fetch /api/me/leads-balance", () => {
    expect(source).toMatch(/fetch\(\s*"\/api\/me\/leads-balance"\s*\)/);
  });

  test("res.ok checké avant .json() (anti-crash)", () => {
    expect(source).toMatch(/if\s*\(\s*!res\.ok\s*\)/);
  });

  test("try/catch enveloppant (jamais propager une erreur réseau)", () => {
    expect(source).toMatch(/try\s*\{[\s\S]*fetch\(\s*"\/api\/me\/leads-balance"/);
    expect(source).toMatch(/\}\s*catch\s*\{[\s\S]*\/\/[\s\S]*best-effort/i);
  });

  test("polling 60s (POLL_INTERVAL_MS)", () => {
    expect(source).toMatch(/POLL_INTERVAL_MS\s*=\s*60_?000/);
  });

  test("return null tant que la balance n'est pas chargée (pas de flash UI)", () => {
    expect(source).toMatch(/if\s*\(\s*balance\s*===\s*null\s*\)\s*return\s+null/);
  });

  test("cliquable → /settings/leads", () => {
    expect(source).toMatch(/href="\/settings\/leads"/);
  });

  test("seuils couleur : empty / critical < 10 / low < 50", () => {
    expect(source).toMatch(/balance\.balance\s*<=\s*0/); // empty
    expect(source).toMatch(/balance\.balance\s*<\s*10/); // critical
    expect(source).toMatch(/balance\.balance\s*<\s*50/); // low
  });

  test("data-testid pour E2E", () => {
    expect(source).toMatch(/data-testid="leads-balance-badge"/);
  });

  test("cleanup interval + cancelled flag (pas de leak / setState après unmount)", () => {
    expect(source).toMatch(/clearInterval\(/);
    expect(source).toMatch(/cancelled\s*=\s*true/);
  });
});
