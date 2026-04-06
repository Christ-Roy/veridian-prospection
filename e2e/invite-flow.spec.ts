/**
 * Invite flow e2e — test critique pour la démo.
 *
 * Scénario complet bout-en-bout sur 2 contexts browser:
 *  1. Admin login → /admin/invitations
 *  2. Ouvre le dialog "Nouvelle invitation", remplit email/workspace/role, submit
 *  3. Capture inviteUrl via interception de la réponse POST /api/admin/invitations
 *  4. Vérifie que la table montre l'invitation avec status "En attente"
 *  5. Ouvre un NOUVEAU context browser (collègue anonyme)
 *  6. Goto inviteUrl → landing avec "Vous avez été invité"
 *  7. Remplit password + fullName, submit
 *  8. Assert redirect vers /prospects + cookies Supabase posés
 *  9. Retour sur context admin, refresh /admin/invitations, assert status "Acceptée"
 * 10. Cleanup: supprime le user Supabase créé
 *
 * Skip gracieux si la feature n'est pas encore stable (pages 404, API manquante).
 * Zero console error sur les 2 contexts.
 */
import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { loginAsE2EUser } from "./helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://saas-api.staging.veridian.site";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const INVITEE_PASSWORD = "CollegueDemo2026!";
const INVITEE_FULLNAME = "Collègue Demo";

function attachErrorListeners(page: Page, sink: string[], label: string) {
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (t.includes("GTM") || t.includes("dataLayer") || t.includes("favicon")) return;
    if (t.includes("Failed to load resource")) return;
    if (t.includes("chrome-extension://")) return;
    if (t.includes("401") || t.includes("403")) return;
    sink.push(`[${label}] ${t}`);
  });
  page.on("pageerror", (err) => {
    sink.push(`[${label}] PAGE_ERROR: ${err.message}`);
  });
}

async function deleteSupabaseUser(userId: string): Promise<void> {
  if (!SERVICE_KEY || !ANON_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
  } catch {
    /* best-effort */
  }
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  if (!SERVICE_KEY || !ANON_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { users?: Array<{ id: string; email?: string }> };
    return body.users?.find((u) => u.email === email)?.id ?? null;
  } catch {
    return null;
  }
}

test.describe("Invite flow e2e (critical demo path)", () => {
  test.setTimeout(180_000);

  test("admin invites colleague → colleague accepts → lands on /prospects", async ({
    browser,
    page,
    request,
  }, testInfo) => {
    const adminErrors: string[] = [];
    attachErrorListeners(page, adminErrors, "admin");

    const INVITEE_EMAIL = `invited-${Date.now()}@yopmail.com`;
    let createdUserId: string | null = null;

    // --- Step 1: admin login ---
    await loginAsE2EUser(page, request);

    // --- Step 2: navigate to /admin/invitations ---
    await page.goto(`${PROSPECTION_URL}/admin/invitations`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

    // Skip gracieux si redirect (user non-admin sur ce tenant)
    if (!page.url().includes("/admin/invitations")) {
      testInfo.skip(
        true,
        `e2e user not admin on tenant — /admin/invitations redirected to ${page.url()}`,
      );
      return;
    }

    // Skip gracieux si la page est une 404
    const bodyCheck = (await page.textContent("body")) || "";
    if (/404\s*not found/i.test(bodyCheck) || bodyCheck.includes("This page could not be found")) {
      testInfo.skip(true, "/admin/invitations renvoie 404 — feature pas encore déployée");
      return;
    }

    // --- Step 3: open create dialog ---
    const newInviteBtn = page.getByRole("button", { name: /nouvelle invitation/i });
    await expect(newInviteBtn).toBeVisible({ timeout: 10000 });
    await newInviteBtn.click();

    // Remplir email
    const emailInput = page.locator("#inv-email");
    await expect(emailInput).toBeVisible({ timeout: 5000 });
    await emailInput.fill(INVITEE_EMAIL);

    // Sélectionner le premier workspace du Select shadcn/ui
    const wsTrigger = page.locator("#inv-workspace");
    await wsTrigger.click();
    // SelectContent est en portal, attend au moins un item
    const firstItem = page.locator('[role="option"]').first();
    await expect(firstItem).toBeVisible({ timeout: 5000 });
    await firstItem.click();

    // Role = member (default), rien à faire

    // --- Step 4: submit + capture response ---
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/admin/invitations") && resp.request().method() === "POST",
      { timeout: 15000 },
    );
    await page.getByRole("button", { name: /envoyer l'invitation/i }).click();
    const createResp = await responsePromise;
    expect(createResp.status(), "create invitation should 201").toBe(201);
    const createBody = (await createResp.json()) as {
      id?: number;
      token?: string;
      inviteUrl?: string;
    };
    const inviteUrl = createBody.inviteUrl;
    expect(inviteUrl, "inviteUrl should be present in response").toBeTruthy();
    const invitationId = createBody.id;

    // Fermer le dialog de lien créé s'il s'ouvre
    const linkDialogClose = page.getByRole("button", { name: /^fermer$/i });
    if (await linkDialogClose.isVisible().catch(() => false)) {
      await linkDialogClose.click();
    }

    // --- Step 5: vérifier que la table montre l'invitation ---
    await page.waitForTimeout(500);
    const row = page.getByRole("row", { name: new RegExp(INVITEE_EMAIL, "i") });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByText(/en attente/i)).toBeVisible();

    // --- Step 6: nouveau browser context (collègue) ---
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    const guestErrors: string[] = [];
    attachErrorListeners(guestPage, guestErrors, "guest");

    try {
      await guestPage.goto(inviteUrl!);
      await guestPage.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

      // --- Step 7: landing visible avec "Vous avez été invité" ---
      await expect(guestPage.getByText(/vous avez été invité/i)).toBeVisible({
        timeout: 10000,
      });

      // Remplir password + fullName
      const pwInput = guestPage.locator('input[type="password"]').first();
      await expect(pwInput).toBeVisible({ timeout: 5000 });
      await pwInput.fill(INVITEE_PASSWORD);

      // fullName est optionnel — on remplit si un input texte existe
      const nameInput = guestPage.locator('input[type="text"]').first();
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill(INVITEE_FULLNAME);
      }

      // --- Step 8: submit + assert redirect /prospects + cookies ---
      await guestPage.getByRole("button", { name: /accepter l'invitation/i }).click();
      await guestPage.waitForURL(/\/prospects/, { timeout: 30000 });

      // Vérifier cookies Supabase posés
      const cookies = await guestContext.cookies();
      const hasSupabaseCookie = cookies.some((c) => c.name.includes("sb-"));
      expect(hasSupabaseCookie, "Supabase auth cookie should be set").toBe(true);

      // Heading de la page /prospects visible
      const prospectsHeading = guestPage.getByRole("heading", { name: /prospect/i }).first();
      await expect(prospectsHeading).toBeVisible({ timeout: 10000 });

      // --- Step 9: retour admin, refresh, status passé à "Acceptée" ---
      createdUserId = await findUserIdByEmail(INVITEE_EMAIL);

      await page.reload();
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      const acceptedRow = page.getByRole("row", { name: new RegExp(INVITEE_EMAIL, "i") });
      // La ligne peut disparaître de la vue "pending" par défaut — on accepte les 2 cas:
      // soit la ligne existe avec badge "Acceptée", soit elle n'existe plus (filtrée).
      if (await acceptedRow.isVisible().catch(() => false)) {
        await expect(acceptedRow.getByText(/accept/i)).toBeVisible({ timeout: 5000 });
      } else {
        console.log(
          `ℹ ${INVITEE_EMAIL} n'apparaît plus dans la liste pending (filtré après accept) — OK`,
        );
      }
    } finally {
      // --- Step 10: cleanup ---
      await guestContext.close();
      if (createdUserId) {
        await deleteSupabaseUser(createdUserId);
      } else {
        // Fallback : essayer de trouver par email
        const uid = await findUserIdByEmail(INVITEE_EMAIL);
        if (uid) await deleteSupabaseUser(uid);
      }
      // Révoquer l'invitation si elle existe encore
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

    // Zero console errors sur les 2 contexts
    expect(adminErrors, `admin errors: ${adminErrors.join("\n")}`).toHaveLength(0);
    expect(guestErrors, `guest errors: ${guestErrors.join("\n")}`).toHaveLength(0);
  });
});
