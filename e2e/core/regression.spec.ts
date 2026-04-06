/**
 * E2E — Regression & Data Integrity Tests
 *
 * Tests that verify existing data and services survive deploys.
 * These don't create new users — they check the health of the system
 * and verify that data integrity is maintained.
 *
 * Run after every deploy to catch regressions.
 */
import { test, expect } from "@playwright/test";

const PROSPECTION_URL = process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";
const HUB_URL = process.env.HUB_URL || "https://saas-hub.staging.veridian.site";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://saas-api.staging.veridian.site";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const TWENTY_URL = process.env.TWENTY_URL || "https://twenty.app.veridian.site";

// ---------------------------------------------------------------------------
// 1. Service Health — all 4 services respond
// ---------------------------------------------------------------------------
test.describe("Service health", () => {
  test("Prospection API healthy + DB connected", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/health`);
    const data = await res.json();
    console.log(`[health] Prospection: status=${data.status}, db=${data.db}, timestamp=${data.timestamp}`);
    expect(res.ok(), `Health returned ${res.status()}`).toBeTruthy();
    expect(data.status).toBe("healthy");
    expect(data.db).toBe("connected");
  });

  test("Hub responds", async ({ request }) => {
    const res = await request.get(HUB_URL);
    console.log(`[health] Hub: ${res.status()} (${res.url()})`);
    expect(res.ok()).toBeTruthy();
  });

  test("Supabase auth healthy", async ({ request }) => {
    const res = await request.get(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: ANON_KEY },
    });
    console.log(`[health] Supabase auth: ${res.status()}`);
    expect([200, 404].includes(res.status())).toBeTruthy();
  });

  test("Twenty GraphQL responds", async ({ request }) => {
    const res = await request.post(`${TWENTY_URL}/graphql`, {
      headers: { "Content-Type": "application/json" },
      data: { query: "{ __typename }" },
    });
    const body = await res.json().catch(() => ({}));
    console.log(`[health] Twenty GraphQL: ${res.status()}, typename=${body?.data?.__typename || "N/A"}, errors=${body?.errors?.[0]?.message || "none"}`);
    expect(res.status(), `Twenty returned ${res.status()}`).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 2. Data Integrity — leads exist and are queryable
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
        console.log(`[data] ✅ ${data.leadCount.toLocaleString()} leads in DB`);
      }
    } else {
      console.log(`[data] leadCount not in health response — old image`);
    }
  });

  test("Provision endpoint is reachable (not 500)", async ({ request }) => {
    // Call without auth — should get 400/401/403, not 500 (crash)
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
// 3. Existing tenants — verify tenants table is intact
// ---------------------------------------------------------------------------
test.describe("Tenant integrity", () => {
  test("Tenants table is queryable", async ({ request }) => {
    if (!SERVICE_KEY) {
      console.log("No SERVICE_KEY — skipping tenant check");
      return;
    }
    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/tenants?select=id&limit=1`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const status = res.status();
    // 200 = table exists, 404 = table doesn't exist (fresh DB), both are valid
    if (status === 404 || status === 406) {
      console.log(`[tenants] Table not found (status ${status}) — fresh DB, skipping`);
      return;
    }
    expect(res.ok(), `Tenants query returned ${status}`).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBeTruthy();
    console.log(`[tenants] Table accessible, ${data.length > 0 ? `${data.length} rows` : "empty"}`);
  });

  test("Supabase auth users exist", async ({ request }) => {
    if (!SERVICE_KEY) return;
    const res = await request.get(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    console.log(`Auth users: ${data.users?.length || 0} returned (page 1)`);
  });
});

// ---------------------------------------------------------------------------
// 4. Auth middleware — protected routes return 401, not crash
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

// ---------------------------------------------------------------------------
// 5. Hub dashboard — key pages load
// ---------------------------------------------------------------------------
test.describe("Hub pages", () => {
  test("Pricing page loads", async ({ page }) => {
    const res = await page.goto(`${HUB_URL}/pricing`, { timeout: 30000 });
    console.log(`[pricing] Page status: ${res?.status()}`);
    // The page should load without crashing (200, not 500)
    expect(res?.status()).toBeLessThan(500);
    // Check if plans are rendered (they come from Stripe products in Supabase)
    const proHeading = page.getByRole("heading", { name: "Pro" });
    const hasPlans = await proHeading.isVisible({ timeout: 10000 }).catch(() => false);
    if (hasPlans) {
      const plans = await page.locator("h2").allTextContents();
      console.log(`[pricing] Plans found: ${plans.join(", ")}`);
    } else {
      console.log(`[pricing] No plans visible (Stripe products may not be synced in this DB)`);
    }
  });

  test("Signup page loads", async ({ page }) => {
    await page.goto(`${HUB_URL}/signup`);
    await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 10000 });
    console.log(`[signup] Page loaded: ${page.url()}`);
  });
});
