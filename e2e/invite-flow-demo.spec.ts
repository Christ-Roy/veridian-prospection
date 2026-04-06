/**
 * Invite flow e2e — DÉMO DEMAIN MATIN.
 *
 * Variante du spec invite-flow.spec.ts qui utilise le compte
 * robert@veridian.site (admin tenant owner) au lieu de e2e-persistent
 * (member classique qui n'a pas accès à /admin/invitations).
 *
 * Ce spec est le MIROIR FIDÈLE du parcours que Robert va faire pendant
 * la démo commerciale. Si ce spec est vert → la démo marchera. Si ce
 * spec pète → fix avant de dormir.
 *
 * Scope:
 *  1. Login robert via form /login
 *  2. Goto /admin/invitations
 *  3. Click "Nouvelle invitation", fill email+workspace+role, submit
 *  4. Capture inviteUrl via response interception
 *  5. Open inviteUrl dans un nouveau browser context (collègue)
 *  6. Landing page visible avec texte "invité par robert"
 *  7. Fill password, submit
 *  8. Assert redirect /prospects + cookies Supabase posés
 *  9. Cleanup user Supabase
 *
 * Usage local:
 *   CI=1 PROSPECTION_URL="http://100.92.215.42:3000" \
 *   SUPABASE_URL="https://saas-api.staging.veridian.site" \
 *   SUPABASE_ANON_KEY="..." SUPABASE_SERVICE_ROLE_KEY="..." \
 *   npx playwright test e2e/invite-flow-demo.spec.ts --reporter=list
 */
import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://saas-api.staging.veridian.site";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const ROBERT_EMAIL = process.env.ROBERT_EMAIL || "robert@veridian.site";
const ROBERT_PASSWORD = process.env.ROBERT_PASSWORD || "DevRobert2026!";
const INVITEE_PASSWORD = "CollegueDemo2026!";
const INVITEE_FULLNAME = "Collègue Démo";

function attachErrorListeners(page: Page, sink: string[], label: string) {
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (t.includes("GTM") || t.includes("dataLayer") || t.includes("favicon")) return;
    if (t.includes("Failed to load resource")) return;
    if (t.includes("chrome-extension://")) return;
    if (t.includes("401") || t.includes("403")) return;
    if (t.includes("net::ERR_")) return;
    sink.push(`[${label}] ${t}`);
  });
  page.on("pageerror", (err) => {
    sink.push(`[${label}] PAGE_ERROR: ${err.message}`);
  });
}

async function loginAsRobert(page: Page) {
  await page.goto(`${PROSPECTION_URL}/login`);
  await page.locator("#email").fill(ROBERT_EMAIL);
  await page.locator("#password").fill(ROBERT_PASSWORD);
  await page.locator('button[type="submit"]').click();
  // Attendre redirect post-login (souvent /prospects)
  await page.waitForURL(/\/(prospects|admin|$)/, { timeout: 20000 }).catch(() => {});
  if (page.url().includes("/login")) {
    throw new Error(`Robert login failed, still on ${page.url()}`);
  }
}

async function deleteSupabaseUser(userId: string): Promise<void> {
  if (!SERVICE_KEY || !ANON_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
  } catch {
    /* best-effort */
  }
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  if (!SERVICE_KEY || !ANON_KEY) return null;
  // Supabase admin API list users paginated — on cherche sur les 5 premières pages
  for (let p = 1; p <= 5; p++) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?page=${p}&per_page=100`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { users?: Array<{ id: string; email?: string }> };
      const match = body.users?.find((u) => u.email === email);
      if (match) return match.id;
      if (!body.users?.length) return null;
    } catch {
      return null;
    }
  }
  return null;
}

test.describe("Invite flow — DEMO CRITICAL", () => {
  test.setTimeout(180_000);

  test("robert invites colleague → colleague accepts → lands on /prospects", async ({
    browser,
    page,
  }) => {
    const adminErrors: string[] = [];
    attachErrorListeners(page, adminErrors, "admin");

    const INVITEE_EMAIL = `demo-collegue-${Date.now()}@yopmail.com`;
    let createdUserId: string | null = null;
    let invitationId: number | null = null;

    // --- 1. Login admin (robert) ---
    await loginAsRobert(page);
    console.log(`[demo] robert logged in, at ${page.url()}`);

    // --- 2. Go to /admin/invitations ---
    await page.goto(`${PROSPECTION_URL}/admin/invitations`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    console.log(`[demo] after goto /admin/invitations: ${page.url()}`);

    expect(page.url(), "robert should be admin, no redirect").toContain("/admin/invitations");

    // --- 3. Open create dialog ---
    const newBtn = page.getByRole("button", { name: /nouvelle invitation/i });
    await expect(newBtn).toBeVisible({ timeout: 10000 });
    await newBtn.click();
    console.log("[demo] create dialog opened");

    // Fill email
    const emailInput = page.locator("#inv-email");
    await expect(emailInput).toBeVisible({ timeout: 5000 });
    await emailInput.fill(INVITEE_EMAIL);

    // Select first workspace (shadcn Select)
    const wsTrigger = page.locator("#inv-workspace");
    await wsTrigger.click();
    const firstOption = page.locator('[role="option"]').first();
    await expect(firstOption).toBeVisible({ timeout: 5000 });
    await firstOption.click();
    console.log(`[demo] form filled email=${INVITEE_EMAIL}`);

    // --- 4. Submit + capture inviteUrl ---
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/admin/invitations") && resp.request().method() === "POST",
      { timeout: 15000 },
    );
    await page.getByRole("button", { name: /envoyer l'invitation/i }).click();
    const createResp = await responsePromise;
    console.log(`[demo] POST /api/admin/invitations → ${createResp.status()}`);
    expect(createResp.status(), "create should be 201").toBe(201);
    const body = (await createResp.json()) as {
      id?: number;
      token?: string;
      inviteUrl?: string;
      emailSent?: boolean;
    };
    expect(body.inviteUrl, "inviteUrl must be in response").toBeTruthy();
    const inviteUrl = body.inviteUrl!;
    invitationId = body.id ?? null;
    console.log(`[demo] inviteUrl captured: ${inviteUrl.slice(0, 60)}...`);
    console.log(`[demo] emailSent=${body.emailSent}`);

    // Close copy-link dialog if it opens
    const closeBtn = page.getByRole("button", { name: /^fermer$/i });
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
    }

    // --- 5. New browser context (collègue) ---
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    const guestErrors: string[] = [];
    attachErrorListeners(guestPage, guestErrors, "guest");

    try {
      console.log(`[demo] guest goto ${inviteUrl}`);
      await guestPage.goto(inviteUrl);
      await guestPage.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

      // --- 6. Landing page visible ---
      await expect(guestPage.getByText(/vous avez été invité/i)).toBeVisible({
        timeout: 10000,
      });
      // Check the inviter email is rendered
      await expect(guestPage.getByText(ROBERT_EMAIL)).toBeVisible({ timeout: 5000 });
      console.log("[demo] landing page OK, inviter email visible");

      // Fill password
      const pwInput = guestPage.locator("#password");
      await expect(pwInput).toBeVisible({ timeout: 5000 });
      await pwInput.fill(INVITEE_PASSWORD);

      // Fill fullName
      const nameInput = guestPage.locator("#fullName");
      if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await nameInput.fill(INVITEE_FULLNAME);
      }

      // --- 7. Submit accept ---
      const acceptPromise = guestPage.waitForResponse(
        (resp) => resp.url().includes("/accept") && resp.request().method() === "POST",
        { timeout: 30000 },
      );
      await guestPage.getByRole("button", { name: /accepter l'invitation/i }).click();
      const acceptResp = await acceptPromise;
      console.log(`[demo] POST /accept → ${acceptResp.status()}`);
      expect(acceptResp.status(), "accept should be 200").toBe(200);

      // --- 8. Redirect /prospects + cookies Supabase ---
      await guestPage.waitForURL(/\/prospects/, { timeout: 30000 });
      console.log(`[demo] guest redirected to ${guestPage.url()}`);

      const cookies = await guestContext.cookies();
      const sbCookie = cookies.find((c) => c.name.includes("sb-"));
      expect(sbCookie, "Supabase auth cookie should be set").toBeTruthy();
      console.log(`[demo] cookie ${sbCookie?.name} posé`);

      // --- 9. Cleanup: find user ID pour delete ---
      createdUserId = await findUserIdByEmail(INVITEE_EMAIL);
      console.log(`[demo] created userId=${createdUserId}`);
    } finally {
      await guestContext.close();
      if (createdUserId) {
        await deleteSupabaseUser(createdUserId);
        console.log(`[demo] cleaned up user ${createdUserId}`);
      }
      if (invitationId) {
        try {
          const cookies = await page.context().cookies();
          const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
          await fetch(`${PROSPECTION_URL}/api/admin/invitations/${invitationId}`, {
            method: "DELETE",
            headers: { Cookie: cookieHeader },
          });
        } catch {
          /* best-effort */
        }
      }
    }

    // Sanity final : zero console error sur les 2 contexts
    expect(adminErrors, `admin console errors:\n${adminErrors.join("\n")}`).toHaveLength(0);
    expect(guestErrors, `guest console errors:\n${guestErrors.join("\n")}`).toHaveLength(0);
  });
});
