/**
 * /api/status smoke — Playwright API test (no browser JS needed, just
 * HTTP assertions). Validates the shape and the performance of the
 * detailed health endpoint.
 *
 * Le endpoint est public (isPublicRoute dans middleware.ts), pas d'auth.
 *
 * SÉCURITÉ : /api/status est public — il NE DOIT PAS exposer les volumes
 * business (entreprises, outreach…). Ces compteurs ont été déplacés vers
 * /api/admin/stats (authed) — pentest T16 finding L1. Ce test vérifie
 * qu'ils ne réapparaissent pas.
 *
 * Couverture:
 *  - 200 OK (ou 503 si unhealthy) — même shape dans les 2 cas
 *  - Shape JSON : status, db, auth, version, uptime_s, checks_ms…
 *  - AUCUN compteur business dans le payload (anti-régression sécu)
 *  - checks_ms.db < 5000 (perf sanity)
 *  - timestamp ISO valide récent (< 60s)
 *  - joignable sans cookie d'auth
 */
import { test, expect } from "@playwright/test";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("/api/status endpoint", () => {
  test("returns well-formed JSON with all expected fields", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/status`);
    // Accept both 200 (healthy/degraded) and 503 (unhealthy) — both must
    // return the same shape.
    expect([200, 503]).toContain(res.status());

    const body = await res.json();

    // Top-level fields
    expect(body).toHaveProperty("status");
    expect(["healthy", "degraded", "unhealthy"]).toContain(body.status);
    expect(body).toHaveProperty("db");
    expect(["ok", "fail"]).toContain(body.db);
    expect(body).toHaveProperty("auth");
    expect(["ok", "fail"]).toContain(body.auth);

    // Meta
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("uptime_s");
    expect(typeof body.uptime_s).toBe("number");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("checks_ms");
    expect(body.checks_ms).toHaveProperty("db");
    expect(typeof body.checks_ms.db).toBe("number");
  });

  test("ne fuite AUCUN compteur business (route publique — pentest T16 L1)", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/status`);
    const body = await res.json();
    // Les volumes business sont sur /api/admin/stats (authed), jamais ici.
    expect(body).not.toHaveProperty("entreprises_count");
    expect(body).not.toHaveProperty("outreach_count");
    expect(body).not.toHaveProperty("followups_count");
    expect(body).not.toHaveProperty("claude_activity_count");
    expect(body).not.toHaveProperty("workspaces_count");
  });

  test("timestamp is recent (< 60s old)", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/status`);
    const body = await res.json();
    const ts = new Date(body.timestamp).getTime();
    const ageMs = Date.now() - ts;
    expect(ageMs, `timestamp should be < 60s old, got ${ageMs}ms`).toBeLessThan(60_000);
    expect(ageMs, `timestamp should not be in the future`).toBeGreaterThanOrEqual(-5_000);
  });

  test("db ping completes under 5s", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/status`);
    const body = await res.json();
    if (body.db === "ok") {
      expect(
        body.checks_ms.db,
        `db check took ${body.checks_ms.db}ms, expected < 5000`
      ).toBeLessThan(5000);
    }
  });

  test("endpoint is reachable without auth cookies", async ({ request }) => {
    // Explicitly strip cookies (this is also the default for a fresh request
    // context, but we want to make the intent explicit).
    const res = await request.get(`${PROSPECTION_URL}/api/status`, {
      headers: { Cookie: "" },
    });
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty("status");
  });
});
