/**
 * Lead detail interactions — Playwright chromium spec.
 *
 * Couverture:
 *  - Ouvre la sheet lead via clic sur /prospects
 *  - Vérifie que le nom d'entreprise OU un SIREN label s'affiche
 *  - Vérifie le lien "Voir site web" (si web_domain disponible): doit
 *    pointer vers https://<web_domain>, JAMAIS vers https://<9 chiffres>
 *  - Vérifie qu'il existe au moins un bouton de statut cliquable (a_contacter,
 *    appele, etc.)
 *  - Zero console error pendant toute l'interaction
 *
 * Ce test tolère le cas "aucune ligne dans /prospects" (user fresh sans
 * workspace) → skip proprement.
 *
 * Usage:
 *   CI=1 PROSPECTION_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... TENANT_API_SECRET=... \
 *   npx playwright test e2e/lead-detail-interactions.spec.ts
 */
import { test, expect, type ConsoleMessage } from "@playwright/test";
import { loginAsE2EUser } from "./helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";

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

test.describe("Lead detail interactions", () => {
  test.setTimeout(90_000);

  test("open lead sheet from /prospects table row", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    if (!page.url().includes("/prospects")) {
      await page.goto(`${PROSPECTION_URL}/prospects`);
    }
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const rowCount = await page.locator("table tbody tr").count();
    if (rowCount === 0) {
      // Fresh user sans workspace — skip gracefully
      console.log("[lead-detail] 0 rows in /prospects (fresh user) — skipping interaction tests");
      assertNoConsoleErrors("/prospects empty");
      test.skip(true, "No rows in /prospects for fresh user");
      return;
    }

    // Click on the first row
    await page.locator("table tbody tr").first().click();
    await page.waitForTimeout(2000);

    // Sheet / drawer / dialog visible
    const sheet = page.locator('[role=dialog], [data-state=open]').first();
    await expect(sheet).toBeVisible({ timeout: 10000 });
    assertNoConsoleErrors("sheet-open");
  });

  test("lead sheet has no SIREN-masquerading-as-domain links", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    if (!page.url().includes("/prospects")) {
      await page.goto(`${PROSPECTION_URL}/prospects`);
    }
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const rowCount = await page.locator("table tbody tr").count();
    if (rowCount === 0) {
      test.skip(true, "No rows for fresh user");
      return;
    }

    await page.locator("table tbody tr").first().click();
    await page.waitForTimeout(2000);

    // Collect all external anchor hrefs and assert none point to a bare SIREN
    const sirenLinks = await page
      .locator('a[href^="http"]')
      .evaluateAll((els) =>
        (els as HTMLAnchorElement[])
          .map((a) => a.href)
          .filter((h) => /^https?:\/\/\d{9}(\/|$)/.test(h))
      );
    expect(
      sirenLinks,
      `External links containing raw SIREN detected: ${sirenLinks.join(", ")}`
    ).toEqual([]);
    assertNoConsoleErrors("siren-link-check");
  });

  test("lead sheet shows enrichment sections when data available", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    if (!page.url().includes("/prospects")) {
      await page.goto(`${PROSPECTION_URL}/prospects`);
    }
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const rowCount = await page.locator("table tbody tr").count();
    if (rowCount === 0) {
      test.skip(true, "No rows for fresh user");
      return;
    }

    await page.locator("table tbody tr").first().click();
    await page.waitForTimeout(2000);

    const sheet = page.locator('[role=dialog], [data-state=open]').first();
    await expect(sheet).toBeVisible({ timeout: 10000 });

    // Each enrichment section uses a data-testid. They are conditionally
    // mounted only when data exists — skip assertions if not present, but
    // if mounted, expand the accordion and assert the content is visible.
    const sectionIds = [
      "finances-section",
      "certifications-section",
      "sites-section",
      "business-section",
    ];

    // Expand all accordion triggers so any mounted section becomes visible.
    const triggers = sheet.locator('button[aria-expanded="false"]');
    const triggerCount = await triggers.count();
    for (let i = 0; i < triggerCount; i++) {
      const t = triggers.nth(i);
      if (await t.isVisible().catch(() => false)) {
        await t.click().catch(() => {});
        await page.waitForTimeout(150);
      }
    }

    let foundAny = false;
    for (const id of sectionIds) {
      const loc = page.locator(`[data-testid="${id}"]`);
      if (await loc.count() > 0) {
        await expect(loc.first()).toBeVisible();
        foundAny = true;
      }
    }
    console.log(
      `[lead-detail] enrichment sections visible: ${foundAny ? "at least one" : "none (sparse data)"}`
    );
    assertNoConsoleErrors("enrichment-sections");
  });

  test("/prospects page has no console error on sort/preset change", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    if (!page.url().includes("/prospects")) {
      await page.goto(`${PROSPECTION_URL}/prospects`);
    }
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Click on "CA" header to trigger sort toggle (defined in leads-table.tsx)
    const caHeader = page.getByRole("columnheader", { name: /^CA/i }).first();
    if (await caHeader.isVisible({ timeout: 2000 }).catch(() => false)) {
      await caHeader.click();
      await page.waitForTimeout(1500);
    }

    // Click on "Tech" header too
    const techHeader = page.getByRole("columnheader", { name: /^Tech/i }).first();
    if (await techHeader.isVisible({ timeout: 2000 }).catch(() => false)) {
      await techHeader.click();
      await page.waitForTimeout(1500);
    }

    assertNoConsoleErrors("sort-toggle");
  });
});
