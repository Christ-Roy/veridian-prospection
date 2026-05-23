/**
 * E2E — Regression & Data Integrity Tests (Prospection seul)
 *
 * Tests that verify Prospection survives deploys without creating users.
 * Run after every deploy to catch regressions.
 *
 * Migration 2026-05-23 :
 *  - Drop tests Twenty (stack sortie 2026-05-18)
 *  - Drop tests Supabase REST (Prospection n'utilise plus Supabase)
 *  - Drop tests Hub UI (couverts par l'agent Hub)
 *  - Garde : health Prospection, data integrity, auth enforcement
 */
import { test, expect } from "@playwright/test";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

// ---------------------------------------------------------------------------
// 1. Service health (Prospection only)
// ---------------------------------------------------------------------------
test.describe("Service health", () => {
  test("Prospection API healthy + DB connected", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/health`);
    const data = await res.json();
    console.log(`[health] Prospection: status=${data.status}, db=${data.db}, timestamp=${data.timestamp}`);
    expect(res.ok(), `Health returned ${res.status()}`).toBeTruthy();
    // saas-standards.md §8: /api/health returns status ∈ {"ok","degraded","down"}
    // Legacy wording "healthy" accepted for back-compat with other apps.
    expect(["ok", "healthy"]).toContain(data.status);
    expect(["ok", "connected"]).toContain(data.db);
  });
});

// ---------------------------------------------------------------------------
// 2. Data integrity — leads still queryable
// ---------------------------------------------------------------------------
test.describe("Data integrity", () => {
  test("Prospect count check (data integrity)", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/health`);
    const data = await res.json();
    console.log(`[data] leadCount: ${data.leadCount ?? "N/A"}`);
    if (typeof data.leadCount === "number") {
      if (data.leadCount === 0) {
        console.log(`[data] Empty DB (fresh clone or staging) — OK`);
      } else {
        expect(data.leadCount, `Lead count dropped to ${data.leadCount}`).toBeGreaterThan(100_000);
        console.log(`[data] ${data.leadCount.toLocaleString()} leads in DB`);
      }
    } else {
      console.log(`[data] leadCount not in health response — old image`);
    }
  });

  test("Provision endpoint is reachable (not 500)", async ({ request }) => {
    // Call sans auth — doit renvoyer 400/401/403, pas 500 (crash)
    const res = await request.post(`${PROSPECTION_URL}/api/tenants/provision`, {
      headers: { "Content-Type": "application/json" },
      data: {},
    });
    const body = await res.json().catch(() => ({}));
    console.log(`[provision] Status: ${res.status()}, body: ${JSON.stringify(body).slice(0, 200)}`);
    expect(res.status(), `Provision crashed with ${res.status()}: ${JSON.stringify(body)}`).not.toBe(500);
    expect([400, 401, 403].includes(res.status()), `Expected 400/401/403, got ${res.status()}`).toBeTruthy();
  });

  test("Login page renders (not crash)", async ({ page }) => {
    await page.goto(`${PROSPECTION_URL}/login`);
    await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 10000 });
    const title = await page.title();
    console.log(`[login] Page title: "${title}", URL: ${page.url()}`);
  });
});

// ---------------------------------------------------------------------------
// 3. Auth middleware — protected routes return 401, not crash
// ---------------------------------------------------------------------------
test.describe("Auth enforcement", () => {
  const protectedEndpoints = [
    "/api/prospects?preset=top_prospects&domain=all&page=1&pageSize=1",
    "/api/leads?page=1&pageSize=1",
    "/api/stats",
    "/api/pipeline",
    "/api/settings",
    "/api/stats/by-department",
  ];

  for (const endpoint of protectedEndpoints) {
    test(`${endpoint} → 401 without auth`, async ({ request }) => {
      const res = await request.get(`${PROSPECTION_URL}${endpoint}`);
      if (res.status() !== 401) {
        const body = await res.text().catch(() => "");
        console.log(`[auth] ${endpoint}: expected 401, got ${res.status()}, body: ${body.slice(0, 200)}`);
      }
      expect(res.status(), `${endpoint} returned ${res.status()} instead of 401`).toBe(401);
    });
  }
});
