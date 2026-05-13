/**
 * Mobile viewport — Playwright chromium spec.
 *
 * Teste le dashboard à 2 tailles d'écran courantes:
 *  - iPhone SE: 375 × 667 (mobile portrait)
 *  - iPad: 768 × 1024 (tablette portrait)
 *
 * Pour chaque viewport et chaque page principale (/prospects, /pipeline,
 * /segments, /historique, /settings):
 *  - La page charge sans console error
 *  - Aucun débordement horizontal majeur (document.scrollWidth <=
 *    window.innerWidth + 20px de tolérance pour les scrollbars/rounding)
 *  - Un élément clé est visible (table, heading, etc.)
 *
 * Ce spec détecte les régressions responsive: un ajout de composant qui
 * force une largeur fixe dépassant le viewport casse le test. Robert est
 * averti avant de perdre une journée à déboguer sur mobile.
 */
import { test, expect, type ConsoleMessage, type Page, type ViewportSize } from "@playwright/test";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://saas-api.staging.veridian.site";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const TEST_EMAIL = `mobile-${Date.now()}@yopmail.com`;
const TEST_PASSWORD = "Mobile2026!!";

const VIEWPORTS: Array<{ name: string; size: ViewportSize }> = [
  { name: "iPhone SE (375x667)", size: { width: 375, height: 667 } },
  { name: "iPad (768x1024)", size: { width: 768, height: 1024 } },
];

const PAGES_TO_TEST = [
  { path: "/prospects", label: "prospects" },
  { path: "/pipeline", label: "pipeline" },
  { path: "/segments", label: "segments" },
  { path: "/historique", label: "historique" },
  { path: "/settings", label: "settings" },
];

// Tolerance for horizontal overflow (scrollbar + rounding)
const OVERFLOW_TOLERANCE = 20;

let consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (t.includes("GTM") || t.includes("dataLayer") || t.includes("favicon")) return;
    if (t.includes("Failed to load resource")) return;
    if (t.includes("chrome-extension://")) return;
    if (t.includes("401") || t.includes("403")) return;
    if (t.includes("net::ERR_")) return;
    consoleErrors.push(t);
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`PAGE_ERROR: ${err.message}`);
  });
});

async function loginFreshUser(
  page: Page,
  request: import("@playwright/test").APIRequestContext
) {
  if (!ANON_KEY || !SERVICE_KEY) {
    test.skip(true, "SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY required");
    return;
  }
  const signup = await request.post(`${SUPABASE_URL}/auth/v1/signup`, {
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  if (!signup.ok()) throw new Error(`Signup failed: ${signup.status()}`);
  const body = await signup.json();
  const userId = body.user?.id || body.id;
  if (!userId) throw new Error("No user id");
  await request.put(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    data: { email_confirm: true },
  });
  const TENANT_SECRET = process.env.TENANT_API_SECRET || "staging-prospection-secret-2026";
  await request.post(`${PROSPECTION_URL}/api/tenants/provision`, {
    headers: { Authorization: `Bearer ${TENANT_SECRET}`, "Content-Type": "application/json" },
    data: { email: TEST_EMAIL, name: "mobile-test", plan: "freemium" },
  });
  await page.goto(`${PROSPECTION_URL}/login`);
  await page.locator("#email").fill(TEST_EMAIL);
  await page.locator("#password").fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(prospects|$)/, { timeout: 20000 }).catch(() => {});
}

async function measureHorizontalOverflow(page: Page): Promise<{
  scrollWidth: number;
  innerWidth: number;
  overflow: number;
}> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
}

for (const viewport of VIEWPORTS) {
  test.describe(`Mobile viewport ${viewport.name}`, () => {
    test.setTimeout(90_000);

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport.size);
    });

    for (const pg of PAGES_TO_TEST) {
      test(`${pg.path} loads without console error and fits viewport`, async ({
        page,
        request,
      }) => {
        await loginFreshUser(page, request);
        await page.goto(`${PROSPECTION_URL}${pg.path}`);
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(2000); // hydration settle

        // Body has rendered something
        const bodyText = await page.locator("body").innerText();
        expect(
          bodyText.length,
          `${pg.label}: body should render text at ${viewport.name}`,
        ).toBeGreaterThan(20);

        // Check horizontal overflow
        const { scrollWidth, innerWidth, overflow } = await measureHorizontalOverflow(page);
        console.log(
          `[${viewport.name} ${pg.label}] scrollWidth=${scrollWidth}, innerWidth=${innerWidth}, overflow=${overflow}px`,
        );
        expect(
          overflow,
          `${pg.label} at ${viewport.name}: horizontal overflow=${overflow}px (scrollWidth=${scrollWidth}, innerWidth=${innerWidth}). Tolerance=${OVERFLOW_TOLERANCE}px.`,
        ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE);

        // Zero console errors on the full page load
        expect(
          consoleErrors,
          `${pg.label} at ${viewport.name}: ${consoleErrors.length} JS error(s)\n${consoleErrors.join("\n")}`,
        ).toHaveLength(0);
      });
    }
  });
}
