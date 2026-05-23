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
 */
import { test, expect, type ConsoleMessage } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

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

test.describe("Admin pages smoke", () => {
  test.setTimeout(90_000);

  test("/admin/workspaces loads for admin user", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/admin/workspaces`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: /workspaces/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: /nouveau workspace/i })).toBeVisible();
    assertNoConsoleErrors("/admin/workspaces");
  });

  test("/admin/members loads for admin user", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/admin/members`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: /membres/i })).toBeVisible({
      timeout: 10000,
    });
    assertNoConsoleErrors("/admin/members");
  });

  test("/admin/kpi loads for admin user", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/admin/kpi`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await expect(page.getByRole("heading", { name: /kpi/i }).first()).toBeVisible({
      timeout: 10000,
    });
    assertNoConsoleErrors("/admin/kpi");
  });
});
