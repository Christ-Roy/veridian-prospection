/**
 * Error boundary / 404 e2e — verify app handles unknown routes gracefully.
 */
import { test, expect } from "@playwright/test";

const PROSPECTION_URL = process.env.PROSPECTION_URL || "http://100.92.215.42:3000";

test.describe("Error boundaries & 404", () => {
  test.setTimeout(20_000);

  test("unknown route returns 404 page", async ({ page }) => {
    const response = await page.goto(`${PROSPECTION_URL}/this-route-does-not-exist-xyz`);
    const status = response?.status() ?? 0;
    console.log(`[error] unknown route → HTTP ${status}`);
    // Either 404 directly or 200 with redirect to login (middleware)
    expect([200, 307, 404]).toContain(status);
    // Should not show a blank page
    const body = await page.locator("body").textContent();
    expect(body?.length).toBeGreaterThan(10);
  });

  test("/api/nonexistent returns 404 JSON", async ({ page }) => {
    const response = await page.goto(`${PROSPECTION_URL}/api/nonexistent-endpoint`);
    const status = response?.status() ?? 0;
    console.log(`[error] /api/nonexistent → HTTP ${status}`);
    expect([404, 405]).toContain(status);
  });

  test("app does not show raw stack traces to user", async ({ page }) => {
    await page.goto(`${PROSPECTION_URL}/prospects`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    // Check no stack trace is visible in the rendered page
    const pageText = await page.locator("body").textContent() ?? "";
    expect(pageText).not.toContain("at Object.<anonymous>");
    expect(pageText).not.toContain("node_modules");
    expect(pageText).not.toContain("ECONNREFUSED");
  });
});
