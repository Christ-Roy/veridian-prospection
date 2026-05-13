/**
 * Keyboard shortcuts — Playwright chromium spec.
 *
 * Valide:
 *  - "?" ouvre la modale "Raccourcis clavier"
 *  - "Escape" ferme la modale
 *  - Séquence "g" puis "p" navigue vers /prospects
 *  - Séquence "g" puis "s" navigue vers /segments
 *  - Les shortcuts single-key sont inertes quand le focus est dans un input
 *  - Aucune console error pendant tout le parcours
 *
 * Testé post-câblage commit 3dc9f9d (hook + modale) + itération actuelle
 * (g+X navigation sequence).
 */
import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

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
  await page.waitForURL(/\/(prospects|$)/, { timeout: 20000 }).catch(() => {});
}

test.describe("Keyboard shortcuts", () => {
  test.setTimeout(90_000);

  test('"?" opens help modal and Escape closes it', async ({ page }) => {
    await loginRobert(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Press "?" (requires shift+/ on US layout — Playwright's keyboard.press
    // handles the modifier automatically if we use "Shift+Slash" or the key
    // string "?")
    await page.keyboard.press("Shift+Slash");
    await page.waitForTimeout(500);

    // Modal should be visible with the expected title
    const heading = page.getByRole("heading", { name: /Raccourcis clavier/i });
    await expect(heading).toBeVisible({ timeout: 5000 });

    // Close with Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await expect(heading).not.toBeVisible({ timeout: 5000 });

    assertNoConsoleErrors("help-modal-open-close");
  });

  test('"g p" sequence navigates to /prospects', async ({ page }) => {
    await loginRobert(page);
    // Go to a different page first so that the navigation is observable
    await page.goto(`${PROSPECTION_URL}/historique`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Make sure the focus is on the body, not an input
    await page.locator("body").click({ position: { x: 10, y: 10 } });

    await page.keyboard.press("g");
    await page.waitForTimeout(100);
    await page.keyboard.press("p");
    await page.waitForURL(/\/prospects/, { timeout: 5000 });
    expect(page.url()).toContain("/prospects");

    assertNoConsoleErrors("g+p-navigation");
  });

  test('"g s" sequence navigates to /segments', async ({ page }) => {
    await loginRobert(page);
    await page.goto(`${PROSPECTION_URL}/prospects`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.locator("body").click({ position: { x: 10, y: 10 } });

    await page.keyboard.press("g");
    await page.waitForTimeout(100);
    await page.keyboard.press("s");
    await page.waitForURL(/\/segments/, { timeout: 5000 });
    expect(page.url()).toContain("/segments");

    assertNoConsoleErrors("g+s-navigation");
  });

  test("single-key shortcuts are ignored when typing in an input", async ({
    page,
    request,
  }) => {
    await loginRobert(page);
    await page.goto(`${PROSPECTION_URL}/prospects`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Find any input on the page (search bar, filter, etc.)
    const firstInput = page.locator("input").first();
    const hasInput = await firstInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasInput) {
      test.skip(true, "No input visible on /prospects to test focus guard");
      return;
    }
    await firstInput.focus();

    const urlBefore = page.url();
    // Type "g" then "p" inside the input — should NOT navigate
    await page.keyboard.type("gp");
    await page.waitForTimeout(1000);

    expect(page.url(), "typing in input should not trigger g+p navigation").toBe(urlBefore);
    // The input should now contain "gp"
    const inputValue = await firstInput.inputValue().catch(() => "");
    expect(inputValue).toContain("gp");

    assertNoConsoleErrors("typing-guard");
  });
});
