/**
 * Tests source-level sur src/components/dashboard/stats-cards.tsx.
 *
 * Pattern source-level (cf pipeline-board.test.tsx, segment-page.test.tsx).
 *
 * Audit défensif setters async post bug-intermittent (commit d5ae9e8) :
 * `setStats` doit être gardé contre 401/500/HTML pour éviter
 * `unhandledrejection` bruit + état corrompu.
 */
import { describe, expect, test } from "vitest";

describe("stats-cards.tsx — guard défensif setStats (audit setters 2026-05-23)", () => {
  let source = "";

  test("setup : lecture du source", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    source = await fs.readFile(
      path.resolve(process.cwd(), "src/components/dashboard/stats-cards.tsx"),
      "utf-8",
    );
    expect(source.length).toBeGreaterThan(0);
  });

  test("exporte StatsCards (sanity)", () => {
    expect(source).toMatch(/export function StatsCards/);
  });

  // Bug latent : si /api/stats renvoie 401/500 avec body JSON
  // ({error: "..."}) ou HTML, `setStats` pouvait stocker un shape qui
  // casserait `stats[s.key]` au render. Le guard r.ok + validation
  // typeof === "object" évite ça.
  test("fetch /api/stats gardé par r.ok avant .json()", () => {
    expect(source).toMatch(/r\.ok\s*\?\s*r\.json\(\)\s*:\s*null/);
  });

  test("setStats validé contre shape non-objet (sabotage-testable)", () => {
    // Le pattern dangereux historique : .then(setStats) direct.
    expect(source).not.toMatch(/\.then\(\s*setStats\s*\)/);
    // Le pattern attendu : valider d & typeof === "object" avant set.
    expect(source).toMatch(/setStats\(\s*d\s*&&\s*typeof\s+d\s*===\s*["']object["']/);
  });

  test("fetch a un .catch fallback (pas d'unhandledrejection)", () => {
    const m = source.match(/fetch\(\s*["']\/api\/stats["']\s*\)[\s\S]*?;\s*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/\.catch\(/);
  });
});
