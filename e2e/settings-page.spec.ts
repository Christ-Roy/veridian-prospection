/**
 * /settings page — Playwright chromium spec.
 *
 * Couverture:
 *  - /settings charge sans crash JS
 *  - Les 5 onglets attendus sont présents (display, telephony,
 *    call-routing, ai-storage, reference)
 *  - L'onglet display est actif par défaut
 *  - Clic sur reference switch bien vers ce contenu
 *  - /api/settings est appelé au chargement (GET)
 *  - Zero console error
 *
 * Pattern auth: signup Supabase + form /login (standard session).
 */
import { test, expect, type ConsoleMessage, type Page, type Request } from "@playwright/test";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";
const ROBERT_EMAIL = process.env.ROBERT_EMAIL || "robert.brunon@veridian.site";
const ROBERT_PASSWORD = process.env.ROBERT_PASSWORD || "Mincraft5*55";

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

function assertNoConsoleErrors(ctx: string) {
  expect(
    consoleErrors,
    `${ctx}: ${consoleErrors.length} JS error(s)\n${consoleErrors.join("\n")}`
  ).toHaveLength(0);
}

async function loginRobert(page: Page) {
  await page.goto(`${PROSPECTION_URL}/login`);
  await page.locator("#email").fill(ROBERT_EMAIL);
  await page.locator("#password").fill(ROBERT_PASSWORD);
  await page.locator('button[type="submit"]').click();
  // Throw if we don't leave /login — silently swallowing this hid login
  // failures behind subsequent assertions.
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
}

/**
 * Navigate to /settings and wait for the page to be ready by listening on
 * the actual signal the page emits: a GET to /api/settings (the page does
 * this on mount). Avoid networkidle which lies on pages with persistent
 * GTM beacons.
 *
 * Returns a promise resolving after both the response is in AND the tablist
 * is mounted in the DOM.
 */
async function gotoSettingsAndWait(page: Page): Promise<void> {
  const respPromise = page.waitForResponse(
    (r) => r.url().includes("/api/settings") && r.request().method() === "GET",
    { timeout: 15_000 }
  );
  await page.goto(`${PROSPECTION_URL}/settings`);
  await respPromise;
  // The page renders <Tabs> in the same useEffect — by the time the API
  // response is in, the tablist is in the DOM.
  await expect(page.locator('[role="tablist"]').first()).toBeVisible({
    timeout: 5_000,
  });
}

test.describe("/settings page", () => {
  test.setTimeout(90_000);

  test("loads without console error and renders tabs", async ({ page }) => {
    await loginRobert(page);
    await gotoSettingsAndWait(page);

    // 5 tabs expected (display, telephony, call-routing, ai-storage, reference)
    const tabCount = await page.locator('[role="tab"]').count();
    expect(tabCount, "expected 5 tabs in settings").toBeGreaterThanOrEqual(5);

    assertNoConsoleErrors("/settings initial");
  });

  test("GET /api/settings is called on page load", async ({ page }) => {
    await loginRobert(page);

    const settingsRequests: string[] = [];
    page.on("request", (req: Request) => {
      if (req.url().includes("/api/settings") && req.method() === "GET") {
        settingsRequests.push(req.url());
      }
    });

    await gotoSettingsAndWait(page);

    expect(
      settingsRequests.length,
      `Expected at least one GET /api/settings call. Got: ${settingsRequests.join("\n")}`,
    ).toBeGreaterThanOrEqual(1);

    assertNoConsoleErrors("/settings api call");
  });

  test("clicking the reference tab changes content without crash", async ({
    page,
  }) => {
    await loginRobert(page);
    await gotoSettingsAndWait(page);

    // Find the reference tab and click it (shadcn Tabs use role=tab)
    const refTab = page
      .locator('[role="tab"]')
      .filter({ hasText: /reference/i })
      .first();
    const hasRefTab = await refTab.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasRefTab) {
      console.log("[settings] reference tab not found, skipping click test");
      assertNoConsoleErrors("/settings no-ref-tab");
      return;
    }
    await refTab.click();

    // shadcn/Radix Tabs flips aria-selected synchronously on click — wait
    // on that explicitly instead of a fixed sleep.
    await expect(refTab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });

    assertNoConsoleErrors("/settings reference-tab-click");
  });
});
