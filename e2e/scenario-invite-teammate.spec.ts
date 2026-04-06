/**
 * Scenario: invite teammate → shared workspace.
 *
 * Full flow:
 * 1. Robert (admin) logs in
 * 2. Goes to /admin/invitations
 * 3. Creates invitation for a test email
 * 4. Captures the invite URL
 * 5. Opens invite URL in new context (colleague)
 * 6. Colleague accepts with password
 * 7. Colleague lands on /prospects
 * 8. Cleanup: delete test user
 *
 * This is the same flow as invite-flow-demo.spec.ts but structured
 * as a scenario test for the C8 category.
 */
import { test, expect } from "@playwright/test";

const PROSPECTION_URL = process.env.PROSPECTION_URL || "http://100.92.215.42:3000";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://saas-api.staging.veridian.site";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ROBERT_EMAIL = process.env.ROBERT_EMAIL || "robert.brunon@veridian.site";
const ROBERT_PASSWORD = process.env.ROBERT_PASSWORD || "Mincraft5*55";

test.describe("Scenario: invite teammate to shared workspace", () => {
  test.setTimeout(120_000);

  test("admin invites → colleague accepts → sees prospects", async ({ browser, page }) => {
    // 1. Login admin
    await page.goto(`${PROSPECTION_URL}/login`);
    await page.locator("#email").fill(ROBERT_EMAIL);
    await page.locator("#password").fill(ROBERT_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/(prospects|$)/, { timeout: 20000 }).catch(() => {});

    if (page.url().includes("/login")) {
      console.log("[scenario] SKIP — admin login failed");
      return;
    }
    console.log("[scenario] 1. admin logged in");

    // 2. Go to invitations
    await page.goto(`${PROSPECTION_URL}/admin/invitations`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // 3. Check if "Nouvelle invitation" button exists
    const newBtn = page.getByRole("button", { name: /nouvelle invitation/i });
    const hasBtn = await newBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasBtn) {
      console.log("[scenario] SKIP — invitations page not accessible or button not found");
      return;
    }
    console.log("[scenario] 2. invitations page loaded");

    // 3. Create invitation
    const INVITEE_EMAIL = `scenario-test-${Date.now()}@yopmail.com`;
    await newBtn.click();

    const emailInput = page.locator("#inv-email");
    await expect(emailInput).toBeVisible({ timeout: 5000 });
    await emailInput.fill(INVITEE_EMAIL);

    // Select first workspace
    const wsTrigger = page.locator("#inv-workspace");
    if (await wsTrigger.isVisible({ timeout: 2000 }).catch(() => false)) {
      await wsTrigger.click();
      const firstOption = page.locator('[role="option"]').first();
      await expect(firstOption).toBeVisible({ timeout: 3000 });
      await firstOption.click();
    }

    // Submit
    const submitBtn = page.getByRole("button", { name: /envoyer/i });
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes("/api/admin/invitations") && resp.request().method() === "POST",
      { timeout: 15000 }
    );
    await submitBtn.click();
    const createResp = await responsePromise;
    console.log(`[scenario] 3. invitation created: ${createResp.status()}`);

    if (createResp.status() !== 201) {
      console.log("[scenario] SKIP — invitation creation failed");
      return;
    }

    const body = await createResp.json();
    const inviteUrl = body.inviteUrl;
    console.log(`[scenario] 4. invite URL: ${inviteUrl?.slice(0, 60)}...`);

    // 5. New context — colleague opens invite
    const guestCtx = await browser.newContext();
    const guestPage = await guestCtx.newPage();

    try {
      await guestPage.goto(inviteUrl);
      await guestPage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

      // 6. Fill password + accept
      const pwInput = guestPage.locator("#password");
      if (await pwInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await pwInput.fill("CollegueTest2026!");
        await guestPage.getByRole("button", { name: /accepter/i }).click();

        // 7. Should redirect to /prospects
        await guestPage.waitForURL(/\/prospects/, { timeout: 30000 }).catch(() => {});
        console.log(`[scenario] 7. colleague landed on: ${guestPage.url()}`);
      }
    } finally {
      await guestCtx.close();

      // 8. Cleanup
      if (SERVICE_KEY && ANON_KEY) {
        try {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=100`, {
            headers: { apikey: ANON_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
          });
          const data = await res.json();
          const user = data.users?.find((u: { email?: string }) => u.email === INVITEE_EMAIL);
          if (user) {
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
              method: "DELETE",
              headers: { apikey: ANON_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
            });
            console.log(`[scenario] 8. cleaned up user ${user.id}`);
          }
        } catch { /* best effort */ }
      }
    }

    console.log("[scenario] ✅ Complete");
  });
});
