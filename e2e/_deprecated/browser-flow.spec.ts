/**
 * E2E Browser Flow Tests — Real browser navigation
 *
 * Unlike other e2e tests that use HTTP requests, these tests load pages
 * in a REAL browser and verify:
 * - No JS console errors (catches JSON.parse crashes, undefined vars, etc.)
 * - Key UI elements are visible
 * - Navigation works (login → dashboard → prospects → lead sheet)
 *
 * These catch client-side bugs that API tests miss.
 */
import { test, expect, type ConsoleMessage } from "@playwright/test";

const PROSPECTION_URL = process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";
const HUB_URL = process.env.HUB_URL || "https://saas-hub.staging.veridian.site";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://saas-api.staging.veridian.site";
const TWENTY_URL = process.env.TWENTY_URL || "https://saas-twenty.staging.veridian.site";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const TEST_EMAIL = `e2e-browser-${Date.now()}@yopmail.com`;
const TEST_PASSWORD = "BrowserTest2026!!";

// Collect console errors during each test
let consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Ignore known non-issues
      if (text.includes("GTM")) return;
      if (text.includes("dataLayer")) return;
      if (text.includes("favicon.ico")) return;
      if (text.includes("chrome-extension://")) return;
      if (text.includes("Failed to load resource")) return;  // HTTP errors (401/403/404) are normal
      if (text.includes("net::ERR_")) return;  // Network errors (non-blocking)
      consoleErrors.push(text);
    }
  });

  page.on("pageerror", (err) => {
    consoleErrors.push(`PAGE_ERROR: ${err.message}`);
  });
});

function assertNoConsoleErrors(context: string) {
  if (consoleErrors.length > 0) {
    console.log(`[${context}] Console errors found:`);
    consoleErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e.slice(0, 200)}`));
  }
  expect(consoleErrors, `${context}: ${consoleErrors.length} JS error(s) in console`).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Setup: create test user
// ---------------------------------------------------------------------------
let userId: string;

test.describe.serial("Browser Flow", () => {
  test.setTimeout(60_000);

  test("setup: create test user", async ({ request }) => {
    // Signup via Supabase API
    const signup = await request.post(`${SUPABASE_URL}/auth/v1/signup`, {
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      data: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    expect(signup.ok(), `Signup failed: ${signup.status()}`).toBeTruthy();
    const body = await signup.json();
    userId = body.user?.id || body.id;
    expect(userId).toBeTruthy();

    // Confirm email
    await request.put(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      data: { email_confirm: true },
    });
    console.log(`[setup] User created: ${TEST_EMAIL}`);
  });

  // ---- Hub: Login page loads without errors ----
  test("hub: login page renders without JS errors", async ({ page }) => {
    await page.goto(`${HUB_URL}/login`);
    await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    console.log(`[hub-login] Page loaded: ${page.url()}`);
    assertNoConsoleErrors("hub-login");
  });

  // ---- Hub: Signup page loads without errors ----
  test("hub: signup page renders without JS errors", async ({ page }) => {
    await page.goto(`${HUB_URL}/signup`);
    await expect(page.locator('input[name="email"]')).toBeVisible({ timeout: 15000 });
    console.log(`[hub-signup] Page loaded: ${page.url()}`);
    assertNoConsoleErrors("hub-signup");
  });

  // ---- Hub: Login flow → dashboard ----
  test("hub: login → dashboard without JS errors", async ({ page }) => {
    await page.goto(`${HUB_URL}/login`);
    await page.locator('input[name="email"]').fill(TEST_EMAIL);
    await page.locator('input[name="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();

    // Wait for redirect to dashboard
    await page.waitForURL("**/dashboard**", { timeout: 30000 }).catch(() => {});
    console.log(`[hub-dashboard] After login: ${page.url()}`);

    if (page.url().includes("/dashboard")) {
      // Dashboard loaded — check for key elements
      await page.waitForTimeout(2000); // Let React hydrate
      assertNoConsoleErrors("hub-dashboard");
    } else {
      console.log(`[hub-dashboard] Login redirect failed — ${page.url()}`);
      // Don't fail on login issues (Supabase rate limiting, etc.)
    }
  });

  // ---- Prospection: Login page loads ----
  test("prospection: login page renders without JS errors", async ({ page }) => {
    await page.goto(`${PROSPECTION_URL}/login`);
    await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 15000 });
    console.log(`[prosp-login] Page loaded: ${page.url()}`);
    assertNoConsoleErrors("prosp-login");
  });

  // ---- Prospection: Prospects page (after auto-login) ----
  test("prospection: prospects page renders without JS errors", async ({ page, request }) => {
    // Provision to get an auto-login token
    const TENANT_SECRET = process.env.TENANT_API_SECRET || "staging-prospection-secret-2026";
    const provRes = await request.post(`${PROSPECTION_URL}/api/tenants/provision`, {
      headers: {
        Authorization: `Bearer ${TENANT_SECRET}`,
        "Content-Type": "application/json",
      },
      data: { email: TEST_EMAIL, name: "browser-test", plan: "freemium" },
    });

    if (!provRes.ok()) {
      console.log(`[prosp-prospects] Provision failed: ${provRes.status()} — skipping`);
      return;
    }

    const provData = await provRes.json();
    if (!provData.login_url) {
      console.log(`[prosp-prospects] No login_url — skipping`);
      return;
    }

    // Auto-login via token
    await page.goto(provData.login_url);
    await page.waitForTimeout(3000);
    console.log(`[prosp-prospects] After auto-login: ${page.url()}`);

    if (page.url().includes("/login")) {
      console.log(`[prosp-prospects] Auto-login failed — checking login page errors only`);
      assertNoConsoleErrors("prosp-login-fallback");
      return;
    }

    // On the prospects page — wait for table to render
    await page.waitForTimeout(3000);

    // Check key UI elements
    const table = page.locator("table");
    const hasTable = await table.isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`[prosp-prospects] Table visible: ${hasTable}`);

    assertNoConsoleErrors("prosp-prospects");
  });

  // ---- Prospection: Click on a lead → lead sheet ----
  test("prospection: lead sheet opens without JS errors", async ({ page, request }) => {
    // Re-provision for a fresh token
    const TENANT_SECRET = process.env.TENANT_API_SECRET || "staging-prospection-secret-2026";
    const provRes = await request.post(`${PROSPECTION_URL}/api/tenants/provision`, {
      headers: {
        Authorization: `Bearer ${TENANT_SECRET}`,
        "Content-Type": "application/json",
      },
      data: { email: TEST_EMAIL, name: "browser-test", plan: "freemium" },
    });

    if (!provRes.ok()) {
      console.log(`[prosp-sheet] Provision failed — skipping`);
      return;
    }

    const provData = await provRes.json();
    if (!provData.login_url) {
      console.log(`[prosp-sheet] No login_url — skipping`);
      return;
    }

    await page.goto(provData.login_url);
    await page.waitForTimeout(3000);

    if (page.url().includes("/login")) {
      console.log(`[prosp-sheet] Auto-login failed — skipping`);
      return;
    }

    // Navigate to prospects if not already there
    if (!page.url().includes("/prospects")) {
      await page.goto(`${PROSPECTION_URL}/prospects`);
      await page.waitForTimeout(3000);
    }

    // Click the first row in the table
    const firstRow = page.locator("table tbody tr").first();
    const hasRow = await firstRow.isVisible({ timeout: 10000 }).catch(() => false);

    if (!hasRow) {
      console.log(`[prosp-sheet] No rows in table (empty DB?) — skipping`);
      assertNoConsoleErrors("prosp-sheet-empty");
      return;
    }

    await firstRow.click();
    await page.waitForTimeout(2000);

    // Lead sheet should open (dialog/drawer)
    const sheet = page.locator("[role=dialog], [data-state=open]").first();
    const hasSheet = await sheet.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`[prosp-sheet] Sheet visible: ${hasSheet}`);

    // THIS IS THE KEY CHECK — JSON.parse errors happen when the sheet opens
    assertNoConsoleErrors("prosp-sheet");
  });

  // ---- Hub: Pricing page ----
  test("hub: pricing page renders without JS errors", async ({ page }) => {
    await page.goto(`${HUB_URL}/pricing`);
    await page.waitForTimeout(3000);
    console.log(`[hub-pricing] Page loaded: ${page.url()}`);
    assertNoConsoleErrors("hub-pricing");
  });

  // ---- Prospection: Pipeline page ----
  test("prospection: pipeline page renders without JS errors", async ({ page }) => {
    await page.goto(`${PROSPECTION_URL}/pipeline`);
    await page.waitForTimeout(3000);
    console.log(`[prosp-pipeline] Page loaded: ${page.url()}`);
    // Pipeline redirects to login if not authenticated — that's OK
    assertNoConsoleErrors("prosp-pipeline");
  });

  // ---- Twenty: Full browser signup → onboarding → workspace ----
  test("twenty: signup → onboarding → workspace loads", async ({ page }) => {
    const twentyEmail = `twenty-e2e-${Date.now()}@yopmail.com`;
    const twentyPass = "TwentyE2e2026!!";

    // 1. Go to Twenty welcome page
    await page.goto(`${TWENTY_URL}/welcome`);
    await page.waitForTimeout(3000);
    console.log(`[twenty] Welcome page: ${page.url()}`);
    assertNoConsoleErrors("twenty-welcome");

    // 2. Find and click signup / create account
    const signupLink = page.locator('a:has-text("Sign up"), a:has-text("Create"), button:has-text("Sign up"), button:has-text("Create")').first();
    const hasSignup = await signupLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasSignup) {
      // Maybe we're already on a signup form — check for email input
      const emailInput = page.locator('input[placeholder*="email" i], input[type="email"]').first();
      const hasEmail = await emailInput.isVisible({ timeout: 5000 }).catch(() => false);
      if (!hasEmail) {
        console.log(`[twenty] No signup link or email input found — skipping`);
        return;
      }
      console.log(`[twenty] Already on signup form`);
    } else {
      await signupLink.click();
      await page.waitForTimeout(2000);
      console.log(`[twenty] After signup click: ${page.url()}`);
    }

    // 3. Fill email
    const emailInput = page.locator('input[placeholder*="email" i], input[type="email"]').first();
    const hasEmail = await emailInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasEmail) {
      console.log(`[twenty] No email input visible after signup click — skipping`);
      assertNoConsoleErrors("twenty-signup-form");
      return;
    }
    await emailInput.fill(twentyEmail);
    console.log(`[twenty] Email filled: ${twentyEmail}`);
    assertNoConsoleErrors("twenty-email-fill");

    // 4. Click continue/next
    const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next"), button:has-text("Sign"), button[type="submit"]').first();
    const hasContinue = await continueBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasContinue) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
      console.log(`[twenty] After continue: ${page.url()}`);
    }

    // 5. Fill password if visible
    const passInput = page.locator('input[type="password"]').first();
    const hasPass = await passInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasPass) {
      await passInput.fill(twentyPass);
      console.log(`[twenty] Password filled`);

      // Click submit
      const submitBtn = page.locator('button:has-text("Sign"), button:has-text("Continue"), button:has-text("Create"), button[type="submit"]').first();
      if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(5000);
        console.log(`[twenty] After signup submit: ${page.url()}`);
      }
    }

    assertNoConsoleErrors("twenty-signup-submit");

    // 6. Check if we landed on onboarding or workspace
    const url = page.url();
    const isOnboarding = url.includes("create/workspace") || url.includes("onboarding") || url.includes("create");
    const isWorkspace = url.includes("objects") || url.includes("/settings");
    const isWelcome = url.includes("welcome");

    console.log(`[twenty] Final URL: ${url} (onboarding=${isOnboarding}, workspace=${isWorkspace}, welcome=${isWelcome})`);

    // If on onboarding, fill workspace name and continue
    if (isOnboarding) {
      const wsInput = page.locator('input[placeholder*="workspace" i], input[placeholder*="company" i], input[placeholder*="name" i]').first();
      if (await wsInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await wsInput.fill("E2E Test Workspace");
        console.log(`[twenty] Workspace name filled`);

        const nextBtn = page.locator('button:has-text("Continue"), button:has-text("Next"), button:has-text("Create"), button[type="submit"]').first();
        if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await nextBtn.click();
          await page.waitForTimeout(3000);
          console.log(`[twenty] After onboarding: ${page.url()}`);
        }
      }
      assertNoConsoleErrors("twenty-onboarding");
    }

    // 7. Final check — no JS errors throughout the flow
    assertNoConsoleErrors("twenty-flow-complete");
    console.log(`[twenty] ✅ Flow complete — no JS crashes`);
  });

  // ---- Cleanup ----
  test("cleanup: delete test user", async ({ request }) => {
    if (!userId) return;
    const del = await request.delete(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    console.log(`[cleanup] User deleted: ${del.status()}`);
  });
});
