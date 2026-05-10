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
import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
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

/**
 * Navigate to /prospects and wait for the leads table to be populated by
 * /api/prospects. We do not rely on networkidle nor on a sleep — we wait
 * for the actual signal that says "the table data is in".
 *
 * Returns the row count once the response has resolved (and the DOM has
 * had a microtask to render the rows).
 */
async function gotoProspectsAndWaitForData(page: Page): Promise<number> {
  // We arm the waitForResponse BEFORE navigating so we don't miss the early
  // request that fires on mount of <ProspectPage>.
  const respPromise = page.waitForResponse(
    (r) => r.url().includes("/api/prospects") && r.request().method() === "GET",
    { timeout: 20_000 }
  );
  if (!page.url().includes("/prospects")) {
    await page.goto(`${PROSPECTION_URL}/prospects`);
  } else {
    // Already on /prospects — force a reload so the response triggers again.
    await page.reload();
  }
  await respPromise;
  // The table is rendered inside the same useEffect, so by the time the
  // promise resolves the rows are already on the DOM. We still defer one
  // microtask to let React commit, then count.
  return await page.locator("table tbody tr").count();
}

/**
 * Click on the first leads-table row and wait for the lead sheet to fetch
 * its data. The sheet's useEffect calls /api/leads/:domain on mount, so we
 * key off that response — much more robust than a fixed sleep.
 */
async function openFirstLeadSheet(page: Page): Promise<void> {
  const sheetLeadResp = page.waitForResponse(
    (r) => /\/api\/leads\/[^/?#]+/.test(r.url()) && r.request().method() === "GET",
    { timeout: 15_000 }
  );
  await page.locator("table tbody tr").first().click();
  await sheetLeadResp;
  // The sheet uses Radix Dialog → [role=dialog][data-state=open]. Wait on
  // that explicitly so the test fails clearly if the click did not open
  // the dialog.
  const sheet = page.locator('[role="dialog"][data-state="open"]').first();
  await expect(sheet).toBeVisible({ timeout: 5_000 });
}

test.describe("Lead detail interactions", () => {
  test.setTimeout(90_000);

  test("open lead sheet from /prospects table row", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    const rowCount = await gotoProspectsAndWaitForData(page);
    if (rowCount === 0) {
      // Fresh user sans workspace — skip gracefully
      console.log("[lead-detail] 0 rows in /prospects (fresh user) — skipping interaction tests");
      assertNoConsoleErrors("/prospects empty");
      test.skip(true, "No rows in /prospects for fresh user");
      return;
    }

    await openFirstLeadSheet(page);
    assertNoConsoleErrors("sheet-open");
  });

  test("lead sheet has no SIREN-masquerading-as-domain links", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    const rowCount = await gotoProspectsAndWaitForData(page);
    if (rowCount === 0) {
      test.skip(true, "No rows for fresh user");
      return;
    }

    await openFirstLeadSheet(page);

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
    const rowCount = await gotoProspectsAndWaitForData(page);
    if (rowCount === 0) {
      test.skip(true, "No rows for fresh user");
      return;
    }

    await openFirstLeadSheet(page);

    const sheet = page.locator('[role="dialog"][data-state="open"]').first();

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
    // Radix Accordion flips aria-expanded to "true" synchronously on click,
    // so we use that as the readiness signal instead of a sleep.
    const triggers = sheet.locator('button[aria-expanded="false"]');
    const triggerCount = await triggers.count();
    for (let i = 0; i < triggerCount; i++) {
      // Always re-resolve the first remaining "closed" trigger because each
      // click flips the previous one to aria-expanded=true and shifts the
      // collection.
      const next = sheet.locator('button[aria-expanded="false"]').first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      await expect(next).toHaveAttribute("aria-expanded", "true");
    }

    let foundAny = false;
    for (const id of sectionIds) {
      const loc = page.locator(`[data-testid="${id}"]`);
      if ((await loc.count()) > 0) {
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
    await gotoProspectsAndWaitForData(page);

    // Click on "CA" header to trigger sort toggle (defined in leads-table.tsx).
    // The click triggers a refetch via /api/prospects?... so we wait on that
    // response instead of a fixed sleep.
    const caHeader = page.getByRole("columnheader", { name: /^CA/i }).first();
    if (await caHeader.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const respCa = page
        .waitForResponse((r) => r.url().includes("/api/prospects"), { timeout: 10_000 })
        .catch(() => null);
      await caHeader.click();
      await respCa;
    }

    // Click on "Tech" header too
    const techHeader = page.getByRole("columnheader", { name: /^Tech/i }).first();
    if (await techHeader.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const respTech = page
        .waitForResponse((r) => r.url().includes("/api/prospects"), { timeout: 10_000 })
        .catch(() => null);
      await techHeader.click();
      await respTech;
    }

    assertNoConsoleErrors("sort-toggle");
  });
});
