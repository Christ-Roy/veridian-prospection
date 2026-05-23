/**
 * E2E Browser Flow Tests — Real browser navigation
 *
 * Unlike other e2e tests that use HTTP requests, these tests load pages
 * in a REAL browser and verify :
 * - No JS console errors (catches JSON.parse crashes, undefined vars, etc.)
 * - Key UI elements are visible
 * - Navigation works (login → dashboard → prospects → lead sheet)
 *
 * These catch client-side bugs that API tests miss.
 *
 * MIGRATION 2026-05-22 (cf todo `2026-05-22-e2e-specs-auth-supabase-inline.md`)
 * --------------------------------------------------------------------------
 * Le spec créait un user éphémère via Supabase GoTrue inline (signup +
 * admin email_confirm + cleanup DELETE) sur `saas-api.staging.veridian.site`.
 * Service Supabase mort. Migré vers le helper canonique `loginAsE2EUser`
 * (Auth.js v5 + compte persistant — donc pas de cleanup à faire). Le test
 * Twenty (`saas-twenty.staging`) a été supprimé : Twenty est sorti de la
 * stack le 2026-05-18 (cf CLAUDE.md racine). Les tests Hub login/dashboard
 * dépendaient du signup Supabase Hub qui ne marche plus côté Hub non plus —
 * ils sont réduits à des smoke "page renders" (sans tentative d'auth).
 */
import { test, expect, type ConsoleMessage } from "@playwright/test";
import { loginAsE2EUser } from "./helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";
const HUB_URL = process.env.HUB_URL || "https://hub.staging.veridian.site";

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

test.describe("Browser Flow", () => {
  test.setTimeout(60_000);

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

  // ---- Prospection: Login page loads ----
  test("prospection: login page renders without JS errors", async ({ page }) => {
    await page.goto(`${PROSPECTION_URL}/login`);
    await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 15000 });
    console.log(`[prosp-login] Page loaded: ${page.url()}`);
    assertNoConsoleErrors("prosp-login");
  });

  // ---- Prospection: Prospects page (after auth via helper canonique) ----
  test("prospection: prospects page renders without JS errors", async ({ page, request }) => {
    await loginAsE2EUser(page, request);

    // loginAsE2EUser navigue sur /prospects ; au cas où on confirme
    if (!page.url().includes("/prospects")) {
      await page.goto(`${PROSPECTION_URL}/prospects`);
    }
    await page.waitForTimeout(3000);

    const table = page.locator("table");
    const hasTable = await table.isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`[prosp-prospects] Table visible: ${hasTable}`);
    expect(hasTable, "prospects page has a table").toBe(true);

    assertNoConsoleErrors("prosp-prospects");
  });

  // ---- Prospection: Click on a lead → lead sheet ----
  test("prospection: lead sheet opens without JS errors", async ({ page, request }) => {
    await loginAsE2EUser(page, request);

    if (!page.url().includes("/prospects")) {
      await page.goto(`${PROSPECTION_URL}/prospects`);
      await page.waitForTimeout(3000);
    }

    // Click the first row in the table
    const firstRow = page.locator("table tbody tr").first();
    const hasRow = await firstRow.isVisible({ timeout: 10000 }).catch(() => false);

    if (!hasRow) {
      console.log(`[prosp-sheet] No rows in table (empty DB?) — skipping click test`);
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

  // ---- Prospection: Pipeline page (test post-auth) ----
  test("prospection: pipeline page renders without JS errors", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/pipeline`);
    await page.waitForTimeout(3000);
    console.log(`[prosp-pipeline] Page loaded: ${page.url()}`);
    assertNoConsoleErrors("prosp-pipeline");
  });
});
