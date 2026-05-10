/**
 * Segments navigation & filters — Playwright chromium spec.
 *
 * Couverture:
 *  - /segments charge sans crash et affiche la liste des segments
 *  - Navigation vers /segments/topleads (segment canonique) sans crash
 *  - Navigation vers /segments/rge/sans_site sans crash JSON
 *    (regression guard pour le bug fix ee51a49 + a17af5b: body vide
 *    ne doit plus faire crasher JSON.parse côté client)
 *  - /segments/foo/bar/qui-nexiste-pas → pas de crash JS (defensive)
 *  - Requests /api/segments trackées pour vérifier qu'elles sortent
 *
 * Auth via signup Supabase + form /login (pattern commun).
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
  // Throw if we don't leave /login — the rest of the test relies on auth.
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
}

/**
 * Navigate to a segments URL and wait for the actual fetch to finish.
 * `/segments` mounts `<SegmentPage>` which calls `fetch("/api/segments")`,
 * `/segments/<slug>` mounts `<SegmentTable>` which calls
 * `fetch("/api/segments/<segment>?...")`. We listen for any /api/segments
 * GET response — covers both cases.
 *
 * Returns once the network call is complete OR the page redirected away
 * from /segments (graceful for unknown slugs that 404 server-side).
 */
async function gotoSegmentsAndWait(page: Page, path: string): Promise<void> {
  const respPromise = page
    .waitForResponse(
      (r) => r.url().includes("/api/segments") && r.request().method() === "GET",
      { timeout: 15_000 }
    )
    .catch(() => null); // unknown segment may not fetch — fall through
  await page.goto(`${PROSPECTION_URL}${path}`);
  await respPromise;
}

test.describe("Segments navigation & filters", () => {
  test.setTimeout(90_000);

  test("/segments index loads without JS errors", async ({ page }) => {
    await loginRobert(page);
    await gotoSegmentsAndWait(page, "/segments");

    // Body should render something (not blank)
    const body = await page.locator("body").innerText();
    expect(body.length, "/segments page should render text").toBeGreaterThan(50);
    assertNoConsoleErrors("/segments");
  });

  test("/segments/topleads renders and fires /api/segments/topleads request", async ({
    page,
  }) => {
    await loginRobert(page);

    // Set up the listener BEFORE navigation so we capture the mount-time
    // request — otherwise we may miss it depending on timing.
    const segmentRequests: string[] = [];
    page.on("request", (req: Request) => {
      if (req.url().includes("/api/segments/")) segmentRequests.push(req.url());
    });

    // Wait for the specific /api/segments/topleads request rather than a
    // generic networkidle. If the route doesn't fire it, fail loud at 15s.
    const respPromise = page.waitForResponse(
      (r) => r.url().includes("/api/segments/topleads") && r.request().method() === "GET",
      { timeout: 15_000 }
    );
    await page.goto(`${PROSPECTION_URL}/segments/topleads`);
    await respPromise;

    // Sanity check on captured requests
    const hasTopleads = segmentRequests.some((u) => u.includes("/api/segments/topleads"));
    expect(
      hasTopleads,
      `Expected /api/segments/topleads call, got: ${segmentRequests.join("\n")}`
    ).toBe(true);

    assertNoConsoleErrors("/segments/topleads");
  });

  test("/segments/rge/sans_site does not crash JSON.parse (regression ee51a49+a17af5b)", async ({
    page,
  }) => {
    await loginRobert(page);
    await gotoSegmentsAndWait(page, "/segments/rge/sans_site");

    // Strict check: zero "Unexpected end of JSON input" errors
    const jsonErrors = consoleErrors.filter((e) =>
      /Unexpected end of JSON input|Failed to execute 'json'/.test(e),
    );
    expect(
      jsonErrors,
      `JSON parse errors detected (regression of bugs fixed in ee51a49 + a17af5b):\n${jsonErrors.join("\n")}`,
    ).toHaveLength(0);

    assertNoConsoleErrors("/segments/rge/sans_site");
  });

  test("/segments/foo/bar-unknown gracefully handles unknown segment", async ({
    page,
  }) => {
    await loginRobert(page);
    // Unknown slug may 404 server-side or render an empty state — the
    // helper tolerates either (response promise is .catch(null)).
    await gotoSegmentsAndWait(
      page,
      `/segments/foo/bar-unknown-segment-${Date.now()}`
    );

    // Unknown segment should render something (empty state, not crash)
    const body = await page.locator("body").innerText();
    expect(body.length).toBeGreaterThan(20);
    assertNoConsoleErrors("/segments/unknown");
  });
});
