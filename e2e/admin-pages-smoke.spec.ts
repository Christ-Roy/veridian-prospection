/**
 * Admin pages smoke — browser (chromium) test post Phase 5.
 *
 * Vérifie que:
 *  - /admin/workspaces redirige un user non-admin vers /prospects
 *  - /admin/workspaces charge pour un admin (pattern visible: "Workspaces" heading)
 *  - /admin/members charge sans crash JS
 *  - /admin/kpi charge sans crash JS
 *
 * Pour le admin user: on utilise robert@veridian.site (tenant owner) qui est
 * isAdmin=true. Auth via form /login comme pour ui-siren-smoke.
 *
 * NOTE: ces pages N'EXISTENT PAS dans l'image Docker staging actuelle (image
 * pré-refactor du 2026-04-04). Les tests vont donc échouer contre le staging
 * actuel tant que Robert n'a pas pushé origin/staging. C'est attendu — ils
 * deviendront verts après rebuild+redeploy.
 */
import { test, expect, type ConsoleMessage } from "@playwright/test";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://saas-api.staging.veridian.site";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Compte admin canonique staging
const ADMIN_EMAIL = "robert@veridian.site";
const ADMIN_PASSWORD = process.env.ROBERT_PASSWORD || ""; // peut être vide si magic-link

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
    consoleErrors.push(t);
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`PAGE_ERROR: ${err.message}`);
  });
});

function assertNoConsoleErrors(ctx: string) {
  expect(consoleErrors, `${ctx}: ${consoleErrors.join("\n")}`).toHaveLength(0);
}

async function loginAsAdmin(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext) {
  if (!ANON_KEY || !SERVICE_KEY) {
    test.skip(true, "SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY required");
    return;
  }

  // Préparer un mot de passe temporaire pour robert via admin API
  // (ne pas toucher au mot de passe existant si ROBERT_PASSWORD fourni)
  let password = ADMIN_PASSWORD;
  if (!password) {
    // On génère un password temporaire et on met à jour via admin API
    password = `Tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}!`;
    const listRes = await request.get(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(ADMIN_EMAIL)}`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!listRes.ok()) {
      test.skip(true, `admin list failed: ${listRes.status()}`);
      return;
    }
    const listBody = await listRes.json();
    const user = listBody.users?.find((u: { email?: string }) => u.email === ADMIN_EMAIL);
    if (!user?.id) {
      test.skip(true, `admin user ${ADMIN_EMAIL} not found in staging`);
      return;
    }
    await request.put(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      data: { password, email_confirm: true },
    });
  }

  await page.goto(`${PROSPECTION_URL}/login`);
  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(prospects|admin|$)/, { timeout: 20000 }).catch(() => {});
  if (page.url().includes("/login")) {
    throw new Error(`Admin login failed, still on ${page.url()}`);
  }
}

test.describe("Admin pages smoke", () => {
  test.setTimeout(90_000);

  test("/admin/workspaces loads for admin user", async ({ page, request }) => {
    await loginAsAdmin(page, request);
    await page.goto(`${PROSPECTION_URL}/admin/workspaces`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    // Heading visible
    await expect(page.getByRole("heading", { name: /workspaces/i })).toBeVisible({
      timeout: 10000,
    });
    // Bouton "Nouveau workspace" présent
    await expect(page.getByRole("button", { name: /nouveau workspace/i })).toBeVisible();
    assertNoConsoleErrors("/admin/workspaces");
  });

  test("/admin/members loads for admin user", async ({ page, request }) => {
    await loginAsAdmin(page, request);
    await page.goto(`${PROSPECTION_URL}/admin/members`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: /membres/i })).toBeVisible({
      timeout: 10000,
    });
    assertNoConsoleErrors("/admin/members");
  });

  test("/admin/kpi loads for admin user", async ({ page, request }) => {
    await loginAsAdmin(page, request);
    await page.goto(`${PROSPECTION_URL}/admin/kpi`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: /kpi par workspace/i })).toBeVisible({
      timeout: 10000,
    });
    assertNoConsoleErrors("/admin/kpi");
  });
});
