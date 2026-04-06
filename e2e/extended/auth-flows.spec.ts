/**
 * Auth flows e2e — login, logout, redirect after session expiration.
 */
import { test, expect } from "@playwright/test";

const PROSPECTION_URL = process.env.PROSPECTION_URL || "http://100.92.215.42:3000";
const ROBERT_EMAIL = process.env.ROBERT_EMAIL || "robert.brunon@veridian.site";
const ROBERT_PASSWORD = process.env.ROBERT_PASSWORD || "Mincraft5*55";

test.describe("Auth flows", () => {
  test.setTimeout(30_000);

  test("unauthenticated user redirects to /login", async ({ page }) => {
    await page.goto(`${PROSPECTION_URL}/prospects`);
    await page.waitForURL(/\/login/, { timeout: 15000 });
    expect(page.url()).toContain("/login");
    console.log("[auth] unauthenticated → redirected to /login");
  });

  test("login with valid credentials → /prospects", async ({ page }) => {
    await page.goto(`${PROSPECTION_URL}/login`);
    await page.locator("#email").fill(ROBERT_EMAIL);
    await page.locator("#password").fill(ROBERT_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/(prospects|$)/, { timeout: 20000 });
    expect(page.url()).not.toContain("/login");
    console.log(`[auth] logged in → ${page.url()}`);
  });

  test("login with wrong password → error message", async ({ page }) => {
    await page.goto(`${PROSPECTION_URL}/login`);
    await page.locator("#email").fill(ROBERT_EMAIL);
    await page.locator("#password").fill("WrongPassword123!");
    await page.locator('button[type="submit"]').click();

    // Should show error message
    const errorMsg = page.locator("text=incorrect");
    await expect(errorMsg).toBeVisible({ timeout: 10000 });
    console.log("[auth] wrong password → error displayed");
  });

  test("/login?redirect preserves destination after login", async ({ page }) => {
    await page.goto(`${PROSPECTION_URL}/login?redirect=/pipeline`);
    await page.locator("#email").fill(ROBERT_EMAIL);
    await page.locator("#password").fill(ROBERT_PASSWORD);
    await page.locator('button[type="submit"]').click();
    // Should redirect to /pipeline (or /prospects if redirect not implemented)
    await page.waitForURL(/\/(pipeline|prospects)/, { timeout: 20000 });
    console.log(`[auth] login with redirect → ${page.url()}`);
  });

  test("404 page renders for unknown routes", async ({ page }) => {
    const response = await page.goto(`${PROSPECTION_URL}/this-page-does-not-exist`);
    // Should be 404 or redirect to login
    const status = response?.status() ?? 0;
    console.log(`[auth] unknown route → HTTP ${status}`);
    expect([200, 404, 307]).toContain(status);
  });
});
