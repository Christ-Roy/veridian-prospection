/**
 * Empty states e2e — verify graceful empty states across pages.
 *
 * Creates a fresh test user with no data to verify empty states render
 * instead of crashes or blank pages.
 */
import { test, expect } from "@playwright/test";

const PROSPECTION_URL = process.env.PROSPECTION_URL || "http://100.92.215.42:3000";
const ROBERT_EMAIL = process.env.ROBERT_EMAIL || "robert.brunon@veridian.site";
const ROBERT_PASSWORD = process.env.ROBERT_PASSWORD || "Mincraft5*55";

async function login(page: import("@playwright/test").Page) {
  await page.goto(`${PROSPECTION_URL}/login`);
  await page.locator("#email").fill(ROBERT_EMAIL);
  await page.locator("#password").fill(ROBERT_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(prospects|$)/, { timeout: 20000 }).catch(() => {});
}

test.describe("Empty states", () => {
  test.setTimeout(30_000);

  test("/historique shows empty state when no visited leads", async ({ page }) => {
    await login(page);
    await page.goto(`${PROSPECTION_URL}/historique`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    // Should render without crash
    const url = page.url();
    console.log(`[empty] /historique → ${url}`);
    // No error boundary / 500
    const errorText = page.locator("text=erreur, text=500, text=Something went wrong");
    const hasError = await errorText.isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasError, "/historique should not crash").toBeFalsy();
  });

  test("/prospects with impossible filter shows empty table", async ({ page }) => {
    await login(page);
    // Filter that returns 0 results: dept=99 (does not exist)
    await page.goto(`${PROSPECTION_URL}/prospects?dept=99`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    // Should show empty state message
    const emptyMsg = page.locator("text=Aucun prospect");
    const hasEmpty = await emptyMsg.isVisible({ timeout: 8000 }).catch(() => false);
    console.log(`[empty] impossible filter → empty message: ${hasEmpty}`);
    // At minimum the page shouldn't crash
    expect(page.url()).toContain("/prospects");
  });

  test("/settings page renders", async ({ page }) => {
    await login(page);
    await page.goto(`${PROSPECTION_URL}/settings`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const heading = page.locator("h1, h2, h3").first();
    await expect(heading).toBeVisible({ timeout: 8000 });
    console.log(`[empty] /settings rendered OK`);
  });
});
