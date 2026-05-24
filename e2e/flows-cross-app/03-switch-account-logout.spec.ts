/**
 * Flow cross-app #3 — Switch de compte / logout.
 *
 * Couvre le bug 2026-05-22 : un user arrivé via token Hub (Open
 * Prospection) ne pouvait pas se logger sur un autre compte — pas de
 * bouton signOut visible. Bloquait cas démo, machine partagée, switch
 * multi-tenant.
 *
 * Le fix est dans src/app/login/page.tsx :
 *   - quand useSession().status === "authenticated", on affiche un
 *     bandeau "Connecté en tant que <email>" + bouton "Changer de compte"
 *   - le bouton appelle signOut({ redirect:false }) puis router.refresh()
 *
 * Étapes :
 *   1. Login Alice via HMAC autologin (provisionAndLogin helper)
 *   2. Visite /login → vérifie le bandeau "Connecté en tant que alice@…"
 *   3. Clique "Changer de compte" → bandeau disparaît, session vidée
 *   4. Form classique → login user canonique (Bob) avec credentials
 *   5. /api/auth/session = bob, plus alice
 *
 * Anti-régression : si on supprime le bandeau ou le bouton dans
 * login/page.tsx, l'assert step 2 ou step 3 rougit.
 */
import { test, expect } from "@playwright/test";
import {
  provisionAndLogin,
  type ProvisionedTenant,
} from "../helpers/cross-app-login";
import {
  ensureCanonicalUser,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Flow cross-app — Switch de compte / logout", () => {
  test("Alice (Hub autologin) → /login → Changer de compte → Bob (credentials)", async ({
    browser,
    request,
  }) => {
    // Pré-requis : s'assurer que le compte canonique Bob existe en DB
    // (le login credentials a besoin de l'Account bcrypt seedé).
    await ensureCanonicalUser();

    // 1) Login Alice via autologin Hub (token HMAC one-shot)
    const ctx = await browser.newContext();
    const alice: ProvisionedTenant = await provisionAndLogin(request, ctx);

    // 2) Visite /login en étant déjà loggué — bandeau attendu
    const page = await ctx.newPage();
    await page.goto(`${PROSPECTION_URL}/login`);

    const banner = page.locator("text=/déjà connecté.*en tant que/i").first();
    await expect(banner, "bandeau 'Déjà connecté' manquant").toBeVisible({
      timeout: 10_000,
    });
    // Le bandeau doit contenir l'email d'Alice
    await expect(banner.locator("..")).toContainText(alice.email);

    // 3) Bouton "Changer de compte" présent et fonctionnel
    const switchBtn = page.getByRole("button", { name: /changer de compte/i });
    await expect(switchBtn, "bouton 'Changer de compte' manquant").toBeVisible();
    await switchBtn.click();

    // 4) Attendre que la session soit vidée : le bandeau disparaît, le
    //    form classique (email/password) devient utilisable.
    await expect(banner).not.toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByLabel("Email", { exact: true }),
      "form email doit être disponible après signOut",
    ).toBeVisible();

    // Confirme côté backend : /api/auth/session = null/empty
    // Auth.js v5 retourne `null` (literal JSON) quand pas de session, sinon
    // un objet `{ user, expires }`. On normalise via .text() pour éviter
    // que null.user pète.
    const afterLogout = await page.request.get(`${PROSPECTION_URL}/api/auth/session`);
    const afterRaw = await afterLogout.text();
    const afterBody = (() => {
      try {
        return JSON.parse(afterRaw) as { user?: { email?: string } } | null;
      } catch {
        return null;
      }
    })();
    expect(
      afterBody?.user?.email,
      `session encore active après signOut: ${afterRaw}`,
    ).toBeFalsy();

    // 5) Login Bob (credentials canoniques) via le form
    await page.getByLabel("Email", { exact: true }).fill(E2E_USER_EMAIL);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(E2E_USER_PASSWORD);
    await page.getByRole("button", { name: /se connecter/i }).click();

    // Form redirige vers /prospects en cas de succès
    await page.waitForURL(/\/prospects/, { timeout: 20_000 });

    // 6) /api/auth/session = bob (E2E_USER_EMAIL), plus alice
    const sessionRes = await page.request.get(`${PROSPECTION_URL}/api/auth/session`);
    expect(sessionRes.status()).toBe(200);
    const session = (await sessionRes.json()) as {
      user?: { email?: string };
    };
    expect(session.user?.email?.toLowerCase()).toBe(
      E2E_USER_EMAIL.toLowerCase(),
    );
    expect(session.user?.email?.toLowerCase()).not.toBe(
      alice.email.toLowerCase(),
    );

    await ctx.close();
  });
});
