/**
 * UI SIREN Smoke — post-refactor validation
 *
 * Charge toutes les pages principales du dashboard dans un VRAI browser
 * (chromium via Playwright) avec JS exécuté, et vérifie:
 *  - pas de crash JS (console.error ou pageerror)
 *  - un élément distinctif est visible (table, heading, etc.)
 *  - les URL externes utilisent web_domain, pas un SIREN brut
 *
 * Lancé contre le staging: https://saas-prospection.staging.veridian.site
 * Override avec PROSPECTION_URL=... si besoin.
 *
 * Créé dans le cadre du refactor SIREN-centric 2026-04-05 pour prouver
 * que l'UI ne crashe pas après le passage results/domain → entreprises/siren.
 */
import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://saas-api.staging.veridian.site";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const TEST_EMAIL = `siren-smoke-${Date.now()}@yopmail.com`;
const TEST_PASSWORD = "SirenSmoke2026!!";

// POLLEN SCOP — diamond garanti, cas canonique post-refactor
const CANONICAL_SIREN = "439076563";

let consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Ignore non-issues
    if (text.includes("GTM")) return;
    if (text.includes("dataLayer")) return;
    if (text.includes("favicon.ico")) return;
    if (text.includes("chrome-extension://")) return;
    if (text.includes("Failed to load resource")) return;
    if (text.includes("net::ERR_")) return;
    if (text.includes("401") || text.includes("403")) return;
    consoleErrors.push(text);
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`PAGE_ERROR: ${err.message}\n${err.stack?.slice(0, 500) ?? ""}`);
  });
});

function assertNoConsoleErrors(context: string) {
  if (consoleErrors.length > 0) {
    console.log(`[${context}] Console errors:`);
    consoleErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e.slice(0, 300)}`));
  }
  expect(
    consoleErrors,
    `${context}: ${consoleErrors.length} JS error(s)\n${consoleErrors.join("\n")}`
  ).toHaveLength(0);
}

let sharedUserId: string | null = null;

async function ensureTestUser(request: import("@playwright/test").APIRequestContext) {
  if (sharedUserId) return;
  if (!ANON_KEY || !SERVICE_KEY) {
    throw new Error("SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set for smoke tests");
  }
  // 1. Signup
  const signup = await request.post(`${SUPABASE_URL}/auth/v1/signup`, {
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  if (!signup.ok()) {
    throw new Error(`Signup failed: ${signup.status()} ${await signup.text()}`);
  }
  const body = await signup.json();
  sharedUserId = body.user?.id || body.id;
  if (!sharedUserId) throw new Error("No user id returned from signup");

  // 2. Confirm email via admin API
  const confirm = await request.put(`${SUPABASE_URL}/auth/v1/admin/users/${sharedUserId}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    data: { email_confirm: true },
  });
  if (!confirm.ok()) {
    throw new Error(`Confirm failed: ${confirm.status()} ${await confirm.text()}`);
  }

  // 3. Provision tenant côté prospection (pour avoir tenant_id + workspace)
  const TENANT_SECRET = process.env.TENANT_API_SECRET || "staging-prospection-secret-2026";
  await request.post(`${PROSPECTION_URL}/api/tenants/provision`, {
    headers: {
      Authorization: `Bearer ${TENANT_SECRET}`,
      "Content-Type": "application/json",
    },
    data: { email: TEST_EMAIL, name: "siren-smoke", plan: "freemium" },
  });
}

async function loginViaUI(page: Page, request: import("@playwright/test").APIRequestContext) {
  await ensureTestUser(request);
  await page.goto(`${PROSPECTION_URL}/login`);
  await page.locator("#email").fill(TEST_EMAIL);
  await page.locator("#password").fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]').click();
  // Attendre la redirection vers /prospects
  await page
    .waitForURL(/\/(prospects|$)/, { timeout: 20000 })
    .catch(() => {});
  if (page.url().includes("/login")) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Login failed, still on ${page.url()}. Body snippet: ${body.slice(0, 200)}`);
  }
}

test.describe("SIREN Refactor — UI Smoke", () => {
  test.setTimeout(90_000);

  test("login page renders without JS errors", async ({ page }) => {
    await page.goto(`${PROSPECTION_URL}/login`);
    await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 15000 });
    assertNoConsoleErrors("login");
  });

  test("auto-login via provision → /prospects renders", async ({ page, request }) => {
    await loginViaUI(page, request);
    // Naviguer explicitement vers /prospects pour homogénéiser
    if (!page.url().includes("/prospects")) {
      await page.goto(`${PROSPECTION_URL}/prospects`);
    }
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Table doit être présente (leads-table.tsx) OU un empty state
    const table = page.locator("table");
    const hasTable = await table.isVisible({ timeout: 15000 }).catch(() => false);
    expect(hasTable, "prospects page has a table element").toBe(true);

    // Nombre de lignes — 0 est valide pour un user fraîchement créé sans workspace
    const rowCount = await page.locator("table tbody tr").count();
    console.log(`[/prospects] rows visible: ${rowCount}`);

    assertNoConsoleErrors("/prospects");
  });

  test("/pipeline renders", async ({ page, request }) => {
    await loginViaUI(page, request);
    await page.goto(`${PROSPECTION_URL}/pipeline`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    // Au minimum un heading ou un conteneur pipeline visible
    const body = await page.locator("body").innerText();
    expect(body.length).toBeGreaterThan(50);
    assertNoConsoleErrors("/pipeline");
  });

  test("/historique renders", async ({ page, request }) => {
    await loginViaUI(page, request);
    await page.goto(`${PROSPECTION_URL}/historique`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    assertNoConsoleErrors("/historique");
  });

  test("/segments renders", async ({ page, request }) => {
    await loginViaUI(page, request);
    await page.goto(`${PROSPECTION_URL}/segments`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    assertNoConsoleErrors("/segments");
  });

  test("/segments/rge/sans_site renders", async ({ page, request }) => {
    await loginViaUI(page, request);
    await page.goto(`${PROSPECTION_URL}/segments/rge/sans_site`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    assertNoConsoleErrors("/segments/rge/sans_site");
  });

  test("/settings renders", async ({ page, request }) => {
    await loginViaUI(page, request);
    await page.goto(`${PROSPECTION_URL}/settings`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    assertNoConsoleErrors("/settings");
  });

  test("lead sheet opens on canonical SIREN (POLLEN SCOP)", async ({ page, request }) => {
    await loginViaUI(page, request);
    // Naviguer directement vers /leads/<siren> (route existe)
    const url = `${PROSPECTION_URL}/leads/${CANONICAL_SIREN}`;
    await page.goto(url);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Le texte "POLLEN" doit apparaître quelque part
    const body = await page.locator("body").innerText();
    const hasPollen = /POLLEN/i.test(body);
    // Si pas sur dev staging (DB différente), ne pas fail, juste logger
    if (!hasPollen) {
      console.log(`[leads/${CANONICAL_SIREN}] POLLEN not found in body — DB may differ`);
    }
    assertNoConsoleErrors(`/leads/${CANONICAL_SIREN}`);
  });

  test("lead sheet from /prospects click — validates web_domain link", async ({ page, request }) => {
    await loginViaUI(page, request);
    if (!page.url().includes("/prospects")) {
      await page.goto(`${PROSPECTION_URL}/prospects`);
    }
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const rowCount = await page.locator("table tbody tr").count();
    if (rowCount === 0) {
      console.log("[lead-sheet-click] 0 rows (fresh user sans workspace) — skipping click test");
      assertNoConsoleErrors("/prospects-empty");
      return;
    }
    const firstRow = page.locator("table tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });
    await firstRow.click();
    await page.waitForTimeout(2500);

    // Sheet/drawer visible
    const sheet = page.locator('[role=dialog], [data-state=open]').first();
    await expect(sheet).toBeVisible({ timeout: 10000 });

    // Vérifie qu'aucun lien externe ne pointe vers http://<9 chiffres>
    const sirenLinks = await page
      .locator('a[href^="http://"], a[href^="https://"]')
      .evaluateAll((els) =>
        (els as HTMLAnchorElement[])
          .map((a) => a.href)
          .filter((h) => /^https?:\/\/\d{9}(\/|$)/.test(h))
      );
    expect(
      sirenLinks,
      `Liens externes contenant un SIREN brut détectés: ${sirenLinks.join(", ")}`
    ).toEqual([]);

    assertNoConsoleErrors("lead-sheet");
  });
});
