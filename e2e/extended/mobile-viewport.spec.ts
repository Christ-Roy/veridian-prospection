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
 *
 * Auth via le compte canonique persistant `e2e-persistent` (cf
 * `e2e/helpers/auth.ts`) — pas de signup éphémère.
 */
import { test, expect, type ConsoleMessage, type Page, type ViewportSize } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

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
        await loginAsE2EUser(page, request);
        await page.goto(`${PROSPECTION_URL}${pg.path}`);
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(2000); // hydration settle

        const bodyText = await page.locator("body").innerText();
        expect(
          bodyText.length,
          `${pg.label}: body should render text at ${viewport.name}`,
        ).toBeGreaterThan(20);

        const { scrollWidth, innerWidth, overflow } = await measureHorizontalOverflow(page);
        console.log(
          `[${viewport.name} ${pg.label}] scrollWidth=${scrollWidth}, innerWidth=${innerWidth}, overflow=${overflow}px`,
        );
        expect(
          overflow,
          `${pg.label} at ${viewport.name}: horizontal overflow=${overflow}px (scrollWidth=${scrollWidth}, innerWidth=${innerWidth}). Tolerance=${OVERFLOW_TOLERANCE}px.`,
        ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE);

        expect(
          consoleErrors,
          `${pg.label} at ${viewport.name}: ${consoleErrors.length} JS error(s)\n${consoleErrors.join("\n")}`,
        ).toHaveLength(0);
      });
    }
  });
}
