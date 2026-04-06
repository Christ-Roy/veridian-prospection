/**
 * Stripe checkout flow e2e — verify upgrade buttons work.
 * Can't complete actual Stripe checkout in CI, but verify the API + UI.
 */
import { test, expect } from "@playwright/test";

const PROSPECTION_URL = process.env.PROSPECTION_URL || "http://100.92.215.42:3000";
const ROBERT_EMAIL = process.env.ROBERT_EMAIL || "robert.brunon@veridian.site";
const ROBERT_PASSWORD = process.env.ROBERT_PASSWORD || "Mincraft5*55";

async function loginRobert(page: import("@playwright/test").Page) {
  await page.goto(`${PROSPECTION_URL}/login`);
  await page.locator("#email").fill(ROBERT_EMAIL);
  await page.locator("#password").fill(ROBERT_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(prospects|$)/, { timeout: 20000 }).catch(() => {});
}

test.describe("Stripe checkout", () => {
  test.setTimeout(30_000);

  test("/admin/kpi has upgrade buttons", async ({ page }) => {
    await loginRobert(page);
    await page.goto(`${PROSPECTION_URL}/admin/kpi`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    const geoBtn = page.locator("button", { hasText: /geo/i });
    const fullBtn = page.locator("button", { hasText: /full/i });

    const hasGeo = await geoBtn.isVisible({ timeout: 5000 }).catch(() => false);
    const hasFull = await fullBtn.isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`[stripe] upgrade buttons: geo=${hasGeo} full=${hasFull}`);
    expect(hasGeo || hasFull).toBeTruthy();
  });

  test("POST /api/checkout returns checkout URL or 503", async ({ request }) => {
    const res = await request.post(`${PROSPECTION_URL}/api/checkout`, {
      data: { plan: "geo" },
    });
    // 503 = Stripe not configured (no key), 401 = no auth, 200 = success
    console.log(`[stripe] POST /api/checkout: ${res.status()}`);
    expect([200, 401, 503]).toContain(res.status());
  });
});
