/**
 * Admin pages smoke — browser (chromium) test.
 *
 * Vérifie que:
 *  - /admin/workspaces charge pour un admin (heading "Workspaces")
 *  - /admin/members charge sans crash JS
 *  - /admin/kpi charge sans crash JS
 *
 * Auth via le compte canonique `e2e-persistent` (owner de son tenant →
 * isAdmin=true, cf user-context.ts).
 *
 * Listener console : on attache APRÈS login via `captureConsoleErrorsAfterLogin()`
 * — sinon on capture les 3 × 401 légitimes du root layout sur /login
 * (cf e2e/helpers/console.ts).
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";
import { captureConsoleErrorsAfterLogin } from "../helpers/console";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

const IGNORE_PATTERNS = [
  /GTM/,
  /dataLayer/,
  /favicon/,
  /Failed to load resource/,
  /chrome-extension:\/\//,
  /\b401\b/,
  /\b403\b/,
];

test.describe("Admin pages smoke", () => {
  test.setTimeout(90_000);

  test("/admin/workspaces loads for admin user", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    const { errors } = captureConsoleErrorsAfterLogin(page, IGNORE_PATTERNS);
    page.on("pageerror", (err) => errors.push(`PAGE_ERROR: ${err.message}`));

    await page.goto(`${PROSPECTION_URL}/admin/workspaces`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: /workspaces/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: /nouveau workspace/i })).toBeVisible();
    expect(errors, `/admin/workspaces: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("/admin/members loads for admin user", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    const { errors } = captureConsoleErrorsAfterLogin(page, IGNORE_PATTERNS);
    page.on("pageerror", (err) => errors.push(`PAGE_ERROR: ${err.message}`));

    await page.goto(`${PROSPECTION_URL}/admin/members`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: /membres/i })).toBeVisible({
      timeout: 10000,
    });
    expect(errors, `/admin/members: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("/admin/kpi loads for admin user", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    const { errors } = captureConsoleErrorsAfterLogin(page, IGNORE_PATTERNS);
    page.on("pageerror", (err) => errors.push(`PAGE_ERROR: ${err.message}`));

    await page.goto(`${PROSPECTION_URL}/admin/kpi`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: /kpi/i }).first()).toBeVisible({
      timeout: 10000,
    });
    expect(errors, `/admin/kpi: ${errors.join("\n")}`).toHaveLength(0);
  });
});
