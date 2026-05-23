/**
 * Invite flow e2e — DÉMO COMMERCIALE.
 *
 * Variante du spec invite-flow.spec.ts axée démo : vérifie en plus que
 * l'email de l'inviteur s'affiche sur la landing page d'invitation (point
 * crucial pour la confiance lors d'une démo client).
 *
 * Auth via le compte canonique `e2e-persistent` (owner → isAdmin=true).
 * Migration Supabase → Auth.js v5 (2026-05-23) :
 *  - Plus de signup Supabase, accept invitation crée le user via Prisma
 *  - Cookie session = `authjs.session-token`
 *  - Cleanup user via Prisma direct
 *
 * Scope:
 *  1. Login admin (compte canonique persistant)
 *  2. Goto /admin/invitations
 *  3. Crée invitation
 *  4. Capture inviteUrl
 *  5. Guest ouvre invite — landing avec email inviter visible
 *  6. Accept password — redirect /prospects + cookie Auth.js
 *  7. Cleanup user Prisma + invitation
 */
import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsE2EUser, E2E_USER_EMAIL } from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

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

let prismaSingleton: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prismaSingleton) prismaSingleton = new PrismaClient();
  return prismaSingleton;
}

async function deleteUserByEmail(email: string): Promise<void> {
  try {
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return;
    await prisma.workspaceMember.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.account.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

test.describe("Invite flow — DEMO CRITICAL", () => {
  test.setTimeout(180_000);

  test("admin invites colleague → colleague accepts → lands on /prospects", async ({
    browser,
    page,
    request,
  }) => {
    const adminErrors: string[] = [];
    attachErrorListeners(page, adminErrors, "admin");

    const INVITEE_EMAIL = `demo-collegue-${Date.now()}@yopmail.com`;
    let invitationId: number | null = null;

    // --- 1. Login admin (compte canonique) ---
    await loginAsE2EUser(page, request);

    // --- 2. Go to /admin/invitations ---
    await page.goto(`${PROSPECTION_URL}/admin/invitations`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    expect(page.url(), "compte canonique should be admin, no redirect").toContain(
      "/admin/invitations",
    );

    // --- 3. Open create dialog ---
    const newBtn = page.getByRole("button", { name: /nouvelle invitation/i });
    await expect(newBtn).toBeVisible({ timeout: 10000 });
    await newBtn.click();

    const emailInput = page.locator("#inv-email");
    await expect(emailInput).toBeVisible({ timeout: 5000 });
    await emailInput.fill(INVITEE_EMAIL);

    const wsTrigger = page.locator("#inv-workspace");
    await wsTrigger.click();
    const firstOption = page.locator('[role="option"]').first();
    await expect(firstOption).toBeVisible({ timeout: 5000 });
    await firstOption.click();

    // --- 4. Submit + capture inviteUrl ---
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/admin/invitations") && resp.request().method() === "POST",
      { timeout: 15000 },
    );
    await page.getByRole("button", { name: /envoyer l'invitation/i }).click();
    const createResp = await responsePromise;
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

    const closeBtn = page.getByRole("button", { name: /^fermer$/i });
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
    }

    // --- 5. New context (collègue) ---
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    const guestErrors: string[] = [];
    attachErrorListeners(guestPage, guestErrors, "guest");

    try {
      await guestPage.goto(inviteUrl);
      await guestPage.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

      // --- 6. Landing visible + inviter email rendu (point clé démo) ---
      await expect(guestPage.getByText(/vous avez été invité/i)).toBeVisible({
        timeout: 10000,
      });
      await expect(guestPage.getByText(E2E_USER_EMAIL)).toBeVisible({ timeout: 5000 });

      const pwInput = guestPage.locator("#password");
      await expect(pwInput).toBeVisible({ timeout: 5000 });
      await pwInput.fill(INVITEE_PASSWORD);

      const nameInput = guestPage.locator("#fullName");
      if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await nameInput.fill(INVITEE_FULLNAME);
      }

      // --- 7. Accept ---
      const acceptPromise = guestPage.waitForResponse(
        (resp) => resp.url().includes("/accept") && resp.request().method() === "POST",
        { timeout: 30000 },
      );
      await guestPage.getByRole("button", { name: /accepter l'invitation/i }).click();
      const acceptResp = await acceptPromise;
      expect(acceptResp.status(), "accept should be 200").toBe(200);

      // --- 8. Redirect + cookie Auth.js v5 ---
      await guestPage.waitForURL(/\/prospects/, { timeout: 30000 });
      const cookies = await guestContext.cookies();
      const authCookie = cookies.find((c) => c.name.includes("authjs.session-token"));
      expect(authCookie, "Auth.js session cookie should be set").toBeTruthy();
    } finally {
      await guestContext.close();
      await deleteUserByEmail(INVITEE_EMAIL);
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

    expect(adminErrors, `admin console errors:\n${adminErrors.join("\n")}`).toHaveLength(0);
    expect(guestErrors, `guest console errors:\n${guestErrors.join("\n")}`).toHaveLength(0);
  });
});
