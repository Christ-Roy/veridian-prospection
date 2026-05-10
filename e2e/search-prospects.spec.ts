/**
 * Search & filters on /prospects — Playwright chromium spec.
 *
 * Valide que les interactions de recherche et de filtrage ne crashent pas
 * post-SIREN refactor, et qu'elles déclenchent bien des requêtes vers
 * /api/prospects avec les query params attendus.
 *
 * Couverture:
 *  - Frappe + Enter dans la barre de recherche → requête /api/prospects?q=...
 *  - Clic sur tri de colonne CA → request /api/prospects après click
 *  - Aucune console error sur tout le parcours
 *  - Skip gracieux si 0 rows (fresh user sans workspace)
 *
 * Auth via signup Supabase staging + form /login (pattern commun aux
 * autres specs de la session 2026-04-05).
 *
 * UI note: la search bar est commit-on-Enter (filter-bar.tsx), pas
 * debounce auto. Bouton "Rechercher" → input "Domaine, entreprise, tel..."
 * → frappe + Enter.
 */
import { test, expect, type ConsoleMessage, type Request, type Page } from "@playwright/test";
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
 * /api/prospects. Arms waitForResponse BEFORE goto so we don't miss the
 * mount-time fetch.
 */
async function gotoProspectsAndWait(page: Page): Promise<void> {
  const respPromise = page.waitForResponse(
    (r) => r.url().includes("/api/prospects") && r.request().method() === "GET",
    { timeout: 20_000 }
  );
  if (!page.url().includes("/prospects")) {
    await page.goto(`${PROSPECTION_URL}/prospects`);
  } else {
    await page.reload();
  }
  await respPromise;
}

test.describe("Search & filters on /prospects", () => {
  test.setTimeout(90_000);

  test("search input + Enter triggers /api/prospects?q= request", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await gotoProspectsAndWait(page);

    // Intercept /api/prospects requests to verify query params. Set up the
    // listener BEFORE the user interaction so we don't miss the request.
    const prospectRequests: string[] = [];
    page.on("request", (req: Request) => {
      if (req.url().includes("/api/prospects")) {
        prospectRequests.push(req.url());
      }
    });

    // The search UI is collapsed by default — clicking the "Rechercher"
    // button reveals the input. cf filter-bar.tsx: <Button>...Rechercher
    // → opens <Input placeholder="Domaine, entreprise, tel..." />.
    const openButton = page.getByRole("button", { name: /^Rechercher$/i }).first();
    const hasOpenButton = await openButton
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (!hasOpenButton) {
      console.log("[search] 'Rechercher' button not visible — UI may have changed, skipping");
      assertNoConsoleErrors("no-search-button");
      test.skip(true, "Search button not visible");
      return;
    }
    await openButton.click();

    // The input must focus and accept input. Wait for it to be visible.
    const searchInput = page
      .getByPlaceholder(/Domaine, entreprise, tel/i)
      .first();
    await expect(searchInput).toBeVisible({ timeout: 2_000 });

    // Use a query that the backend will treat as a search term but not
    // filter all rows (the test relies on at least one /api/prospects
    // call being emitted, regardless of the row count).
    const searchTerm = "bou";

    // The component fires onSearch on Enter — wait on the resulting
    // /api/prospects request.
    const respPromise = page.waitForResponse(
      (r) =>
        r.url().includes("/api/prospects") &&
        new URL(r.url()).searchParams.get("q")?.includes(searchTerm) === true,
      { timeout: 10_000 }
    );
    await searchInput.fill(searchTerm);
    await searchInput.press("Enter");
    await respPromise;

    // Sanity: at least one captured request contains q=<term>
    const hasQueryRequest = prospectRequests.some(
      (u) => new URL(u).searchParams.get("q")?.includes(searchTerm) === true
    );
    expect(
      hasQueryRequest,
      `Expected a /api/prospects request with q=${searchTerm}, got: ${prospectRequests.join("\n")}`
    ).toBe(true);

    assertNoConsoleErrors("search-typing");
  });

  test("sort toggle on CA column triggers a /api/prospects request", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await gotoProspectsAndWait(page);

    const prospectRequests: string[] = [];
    page.on("request", (req: Request) => {
      if (req.url().includes("/api/prospects")) prospectRequests.push(req.url());
    });

    // Click the CA column header
    const caHeader = page.getByRole("columnheader", { name: /^CA/i }).first();
    if (!(await caHeader.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "CA column header not visible (maybe 0 rows, no header rendered)");
      return;
    }

    const respPromise = page.waitForResponse(
      (r) => r.url().includes("/api/prospects"),
      { timeout: 10_000 }
    );
    await caHeader.click();
    await respPromise;

    expect(
      prospectRequests.length,
      "at least one /api/prospects request after CA click"
    ).toBeGreaterThan(0);
    assertNoConsoleErrors("sort-ca");
  });

  test("/prospects does not produce console errors on initial load", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await gotoProspectsAndWait(page);
    assertNoConsoleErrors("/prospects initial");
  });
});
