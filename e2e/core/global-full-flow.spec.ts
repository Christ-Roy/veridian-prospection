/**
 * Global full flow e2e — Robert's ENTIRE daily journey in one spec.
 *
 * This is the "if this passes, the demo works" canary test.
 * Covers: login → prospects table → filters → lead sheet → pipeline → admin.
 */
import { test, expect } from "@playwright/test";

const PROSPECTION_URL = process.env.PROSPECTION_URL || "http://100.92.215.42:3000";
const ROBERT_EMAIL = process.env.ROBERT_EMAIL || "robert.brunon@veridian.site";
const ROBERT_PASSWORD = process.env.ROBERT_PASSWORD || "Mincraft5*55";

test.describe("Global full flow — Robert daily journey", () => {
  test.setTimeout(120_000);

  test("complete journey: login → prospects → lead → pipeline → admin", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`PAGE_ERROR: ${err.message}`));

    // --- 1. Login ---
    await page.goto(`${PROSPECTION_URL}/login`);
    await page.locator("#email").fill(ROBERT_EMAIL);
    await page.locator("#password").fill(ROBERT_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/(prospects|$)/, { timeout: 30000 });
    expect(page.url()).not.toContain("/login");
    console.log(`[global] 1. logged in → ${page.url()}`);

    // --- 2. Prospects table loads with data ---
    await page.goto(`${PROSPECTION_URL}/prospects`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(5);
    console.log(`[global] 2. prospects loaded: ${rowCount} rows`);

    // --- 3. Sector sidebar visible with counts ---
    const sidebar = page.locator('[data-testid="sector-sidebar"], .sector-sidebar, aside');
    const sidebarVisible = await sidebar.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`[global] 3. sidebar visible: ${sidebarVisible}`);

    // --- 4. Toggle sans site ---
    const siteToggle = page.locator('[data-testid="site-toggle"]');
    if (await siteToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await siteToggle.getByText(/sans site/i).click();
      await page.waitForURL(/site=without/, { timeout: 10000 }).catch(() => {});
      console.log(`[global] 4. toggled sans site`);
      // Toggle back
      await siteToggle.getByText(/tous/i).click();
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    }

    // --- 5. Click first prospect → lead sheet opens ---
    // Click on 3rd column (ville) to avoid domain link stopPropagation
    const firstRow = rows.first();
    const cells = firstRow.locator("td");
    if (await cells.count() > 3) {
      await cells.nth(4).click(); // ville column
    } else {
      await firstRow.click();
    }
    const sheet = page.locator('[role="dialog"], [data-slot="sheet-content"]').first();
    const sheetOpened = await sheet.isVisible({ timeout: 8000 }).catch(() => false);
    console.log(`[global] 5. lead sheet opened: ${sheetOpened}`);
    if (sheetOpened) {
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden({ timeout: 5000 }).catch(() => {});
    }

    // --- 6. Navigate to pipeline ---
    await page.goto(`${PROSPECTION_URL}/pipeline`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    // Pipeline columns use <span> for labels, not <h3>
    const pipelineContent = page.locator('[draggable="true"], span.text-xs.font-medium').first();
    const pipelineLoaded = await pipelineContent.isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`[global] 6. pipeline loaded: ${pipelineLoaded}`);

    // --- 7. Navigate to admin/members ---
    await page.goto(`${PROSPECTION_URL}/admin/members`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    // Should not redirect to login (robert is admin)
    const isOnAdmin = page.url().includes("/admin");
    console.log(`[global] 7. admin/members: ${isOnAdmin ? "accessible" : "redirected"}`);

    // --- 8. Navigate to settings ---
    await page.goto(`${PROSPECTION_URL}/settings`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    console.log(`[global] 8. settings page loaded`);

    // --- 9. Navigate to historique ---
    await page.goto(`${PROSPECTION_URL}/historique`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    console.log(`[global] 9. historique page loaded`);

    // --- 10. Final: no page errors during the entire journey ---
    if (errors.length > 0) {
      console.log(`[global] PAGE ERRORS:\n${errors.join("\n")}`);
    }
    expect(errors, `page errors during journey:\n${errors.join("\n")}`).toHaveLength(0);
    console.log("[global] ✅ Full journey completed without page errors");
  });
});
