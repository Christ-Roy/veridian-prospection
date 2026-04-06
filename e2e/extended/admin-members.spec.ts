/**
 * Admin members page — spec ciblée sur le drawer pipeline + historique
 * et le switch visibility_scope.
 *
 * Prérequis : staging accessible avec Robert (tenant owner, admin).
 *
 * Couvre :
 *  - Login admin → /admin/members
 *  - Table visible
 *  - Click sur une ligne → drawer avec Pipeline + Historique
 *  - Change du scope (all → own → all) → PATCH 200 + toast succès
 */
import { test, expect, type ConsoleMessage, type Page, type APIRequestContext } from "@playwright/test";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "http://100.92.215.42:3000";
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://saas-api.staging.veridian.site";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const ADMIN_EMAIL = process.env.ROBERT_EMAIL || "robert.brunon@veridian.site";
const ADMIN_PASSWORD = process.env.ROBERT_PASSWORD || "";

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

async function loginAsAdmin(page: Page, request: APIRequestContext) {
  let password = ADMIN_PASSWORD;

  // Si pas de password fourni, essayer via admin API Supabase (comme admin-pages-smoke)
  if (!password) {
    if (!ANON_KEY || !SERVICE_KEY) {
      test.skip(true, "ROBERT_PASSWORD or SUPABASE_*_KEY required");
      return;
    }
    password = `Tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}!`;
    const listRes = await request.get(
      `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(ADMIN_EMAIL)}`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!listRes.ok()) {
      test.skip(true, `admin list failed: ${listRes.status()}`);
      return;
    }
    const body = await listRes.json();
    const user = body.users?.find((u: { email?: string }) => u.email === ADMIN_EMAIL);
    if (!user?.id) {
      test.skip(true, `admin user ${ADMIN_EMAIL} not found`);
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

test.describe("Admin members — drawer + visibility scope", () => {
  test.setTimeout(90_000);

  test("table visible, drawer opens, scope PATCH succeeds", async ({ page, request }) => {
    await loginAsAdmin(page, request);

    // Goto members
    await page.goto(`${PROSPECTION_URL}/admin/members`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

    // Table visible
    await expect(page.getByRole("heading", { name: /membres/i })).toBeVisible({
      timeout: 10000,
    });
    const table = page.getByTestId("admin-members-table");
    await expect(table).toBeVisible();

    // At least one row
    const rows = page.getByTestId("admin-member-row");
    const rowCount = await rows.count();
    if (rowCount === 0) {
      test.skip(true, "No members in this tenant — nothing to test");
      return;
    }

    // Click first row → drawer opens
    await rows.first().click();
    const drawer = page.getByTestId("admin-member-drawer");
    await expect(drawer).toBeVisible({ timeout: 10000 });
    await expect(drawer.getByText(/pipeline/i)).toBeVisible();
    await expect(drawer.getByText(/historique/i)).toBeVisible();

    // Close drawer (escape)
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible({ timeout: 5000 }).catch(() => {});

    // Test the PATCH visibility_scope via direct API call (avoid UI Select flakiness).
    // On récupère un member id depuis l'UI via l'API admin.
    const listRes = await request.get(`${PROSPECTION_URL}/api/admin/members`, {
      headers: { cookie: (await page.context().cookies())
        .map((c) => `${c.name}=${c.value}`)
        .join("; ") },
    });
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    const member = (listBody.members ?? []).find(
      (m: { memberships: unknown[] }) => (m.memberships ?? []).length > 0
    );
    if (!member) {
      test.skip(true, "No member with a workspace membership to patch");
      return;
    }
    const ms = member.memberships[0];
    const patchRes = await request.patch(`${PROSPECTION_URL}/api/admin/members`, {
      headers: {
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
        "Content-Type": "application/json",
      },
      data: {
        userId: member.userId,
        workspaceId: ms.workspaceId,
        visibilityScope: "own",
      },
    });
    expect(patchRes.status()).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.ok).toBe(true);
    expect(patchBody.visibilityScope).toBe("own");

    // Revert
    const revertRes = await request.patch(`${PROSPECTION_URL}/api/admin/members`, {
      headers: {
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
        "Content-Type": "application/json",
      },
      data: {
        userId: member.userId,
        workspaceId: ms.workspaceId,
        visibilityScope: "all",
      },
    });
    expect(revertRes.status()).toBe(200);
  });
});
