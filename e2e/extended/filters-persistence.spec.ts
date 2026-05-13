/**
 * Filters persistence via localStorage — Playwright chromium spec.
 *
 * Valide le câblage useLocalStoragePersist dans prospect-page (commit
 * 6299da8 pour le hook + itération suivante pour le câblage).
 *
 * Couverture:
 *  - Set un state via localStorage avant navigation (page.addInitScript)
 *  - Naviguer vers /prospects
 *  - Vérifier que /api/prospects est appelé avec les bons query params
 *    correspondant aux valeurs persistées (preset, dept)
 *  - Cela prouve que le hook a hydraté les states depuis localStorage
 *    et que le build d'URL utilise bien ces valeurs restaurées
 *
 * Alternative à page.reload() + click, plus déterministe: on injecte
 * les valeurs directement dans localStorage via addInitScript, ce qui
 * ne dépend pas de l'UI pour set/read les filtres.
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

async function loginRobert(page: Page) {
  await page.goto(`${PROSPECTION_URL}/login`);
  await page.locator("#email").fill(ROBERT_EMAIL);
  await page.locator("#password").fill(ROBERT_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(prospects|$)/, { timeout: 20000 }).catch(() => {});
}

test.describe("Filters persistence via localStorage", () => {
  test.setTimeout(90_000);

  test("preset stored in localStorage hydrates on /prospects load", async ({
    page,
  }) => {
    await loginRobert(page);

    // Inject a persisted preset BEFORE the next navigation (addInitScript
    // runs on every new document load — we need to re-navigate after
    // setting it to ensure it's applied).
    await page.addInitScript(() => {
      localStorage.setItem("prospect-presets-v1", JSON.stringify(["top_prospects"]));
      localStorage.setItem("prospect-geo-depts-v1", JSON.stringify(["75", "69"]));
    });

    // Intercept /api/prospects requests
    const prospectRequests: string[] = [];
    page.on("request", (req: Request) => {
      if (req.url().includes("/api/prospects")) {
        prospectRequests.push(req.url());
      }
    });

    await page.goto(`${PROSPECTION_URL}/prospects`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000); // let hydration + first fetch happen

    // At least one /api/prospects request should reflect the persisted preset
    const hasPreset = prospectRequests.some((u) => /[?&]preset=top_prospects/.test(u));
    expect(
      hasPreset,
      `Expected a /api/prospects request with preset=top_prospects after hydration. Got:\n${prospectRequests.join("\n")}`,
    ).toBe(true);

    // And the dept param should contain the persisted depts
    const hasDept = prospectRequests.some((u) => /[?&]dept=[^&]*75/.test(u));
    expect(
      hasDept,
      `Expected a /api/prospects request with dept=75,... after hydration. Got:\n${prospectRequests.join("\n")}`,
    ).toBe(true);

    // Sanity: no console error from the hydration path
    expect(
      consoleErrors,
      `hydration path: ${consoleErrors.join("\n")}`,
    ).toHaveLength(0);
  });

  test("no localStorage → defaults (preset=tous, no dept)", async ({ page }) => {
    await loginRobert(page);
    // Explicitly clear any persisted state
    await page.addInitScript(() => {
      localStorage.removeItem("prospect-presets-v1");
      localStorage.removeItem("prospect-geo-depts-v1");
    });

    const prospectRequests: string[] = [];
    page.on("request", (req: Request) => {
      if (req.url().includes("/api/prospects")) prospectRequests.push(req.url());
    });

    await page.goto(`${PROSPECTION_URL}/prospects`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Default preset is "tous"
    const hasTousDefault = prospectRequests.some((u) => /[?&]preset=tous/.test(u));
    expect(
      hasTousDefault,
      `Expected default preset=tous. Got:\n${prospectRequests.join("\n")}`,
    ).toBe(true);

    // No dept param (or empty) by default
    const hasDept = prospectRequests.some((u) => /[?&]dept=[^&]+/.test(u));
    expect(hasDept, "No dept param should be set by default").toBe(false);
  });
});
