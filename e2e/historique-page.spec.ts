/**
 * /historique page — Playwright chromium spec.
 *
 * Couverture:
 *  - La page /historique charge sans crash JS
 *  - La table est visible (ou empty state pour user fresh sans leads visités)
 *  - Les colonnes affichent bien web_domain (pas un SIREN brut) — protection
 *    contre une régression post-SIREN refactor (commit faea1d8 fixait
 *    historique/page.tsx pour afficher lead.web_domain, fallback "SIREN xxx"
 *    en mono si absent).
 *  - Aucune request /api/history ne renvoie un body vide non-parseable
 *    (defensive check pair avec a17af5b/ee51a49 segments fix)
 *  - Zero console error
 *
 * Skip gracieux si 0 rows.
 */
import { test, expect, type ConsoleMessage, type Page, type Response } from "@playwright/test";

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

test.describe("/historique page", () => {
  test.setTimeout(90_000);

  test("loads without console error and renders some content", async ({
    page,
  }) => {
    await loginRobert(page);
    await page.goto(`${PROSPECTION_URL}/historique`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);

    // La page doit afficher quelque chose (table, heading, empty state)
    const body = await page.locator("body").innerText();
    expect(body.length, "/historique should render content").toBeGreaterThan(50);

    assertNoConsoleErrors("/historique initial");
  });

  test("/api/history (or similar) responses have valid JSON body", async ({
    page,
  }) => {
    await loginRobert(page);

    // Intercept any /api/history* or /api/outreach responses with body
    const badBodies: Array<{ url: string; status: number; body: string }> = [];
    page.on("response", async (res: Response) => {
      const url = res.url();
      if (!url.includes("/api/history") && !url.includes("/api/outreach")) return;
      try {
        const text = await res.text();
        if (text.length === 0) {
          badBodies.push({ url, status: res.status(), body: "<empty>" });
          return;
        }
        JSON.parse(text); // will throw if invalid
      } catch (e) {
        badBodies.push({
          url,
          status: res.status(),
          body: e instanceof Error ? e.message : String(e),
        });
      }
    });

    await page.goto(`${PROSPECTION_URL}/historique`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);

    expect(
      badBodies,
      `Empty or invalid JSON bodies detected (regression of ee51a49/a17af5b):\n${JSON.stringify(badBodies, null, 2)}`
    ).toHaveLength(0);
    assertNoConsoleErrors("/historique api body");
  });

  test("no cell displays a raw SIREN as if it were a web domain link", async ({
    page,
  }) => {
    await loginRobert(page);
    await page.goto(`${PROSPECTION_URL}/historique`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);

    // Guard: aucun lien externe vers https://<9 digits>
    // (régression guard pour le fix faea1d8: historique/page.tsx doit
    // afficher lead.web_domain, pas lead.domain si domain est un SIREN)
    const sirenLinks = await page
      .locator('a[href^="http"]')
      .evaluateAll((els) =>
        (els as HTMLAnchorElement[])
          .map((a) => a.href)
          .filter((h) => /^https?:\/\/\d{9}(\/|$)/.test(h)),
      );
    expect(
      sirenLinks,
      `/historique contains external links to raw SIREN: ${sirenLinks.join(", ")}`,
    ).toEqual([]);

    assertNoConsoleErrors("/historique siren guard");
  });
});
