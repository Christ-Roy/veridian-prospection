/**
 * /api/status smoke — Playwright API test (no browser JS needed, just
 * HTTP assertions). Validates the shape and the performance of the new
 * detailed health endpoint introduced in commit cfa47a2.
 *
 * Le endpoint est public (ajouté à isPublicRoute dans middleware.ts),
 * donc pas besoin d'auth.
 *
 * Couverture:
 *  - 200 OK (ou 503 si unhealthy — on vérifie les 2 cas)
 *  - Shape JSON complète (status, db, entreprises_count, checks_ms, ...)
 *  - entreprises_count > 0 sur staging (DB peuplée)
 *  - checks_ms.db < 5000 (perf sanity check)
 *  - timestamp est un ISO valide récent (< 60s)
 */
import { test, expect } from "@playwright/test";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";

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
    expect(body).toHaveProperty("supabase");
    expect(["ok", "fail", "not_configured"]).toContain(body.supabase);
    expect(body).toHaveProperty("twenty");
    expect(["ok", "fail", "not_configured"]).toContain(body.twenty);

    // Counts (may be null if table not found, -1 if query failed)
    expect(body).toHaveProperty("entreprises_count");
    expect(body).toHaveProperty("outreach_count");
    expect(body).toHaveProperty("followups_count");
    expect(body).toHaveProperty("claude_activity_count");
    expect(body).toHaveProperty("workspaces_count");

    // Meta
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("uptime_s");
    expect(typeof body.uptime_s).toBe("number");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("checks_ms");
    expect(body.checks_ms).toHaveProperty("db");
    expect(typeof body.checks_ms.db).toBe("number");
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

  test("entreprises_count > 0 on healthy staging (SIREN refactor sanity)", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/status`);
    const body = await res.json();
    // Only assert when the DB is healthy and the count is not an error marker
    if (body.status !== "unhealthy" && typeof body.entreprises_count === "number" && body.entreprises_count >= 0) {
      expect(
        body.entreprises_count,
        "post-SIREN refactor staging should have ~996K entreprises"
      ).toBeGreaterThan(10_000);
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
