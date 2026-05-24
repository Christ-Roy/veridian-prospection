/**
 * Flow cross-app #6 — Login Credentials direct (form /login).
 *
 * Le chemin "form classique" — différent du SSO Hub :
 *   1. User canonique seedé (User + Account credentials bcrypt en Prisma)
 *   2. /login → form rempli email + password
 *   3. signIn("credentials") côté front → POST /api/auth/callback/credentials
 *   4. Cookie session posé + redirect /prospects
 *   5. /api/auth/session retourne le user
 *
 * Pourquoi cette spec :
 *   - C'est le chemin d'auth par défaut pour un user existant (sans Hub)
 *   - Le flow 3 le couvre EN PARTIE (étape "login Bob") mais après un
 *     logout, ce qui mélange deux invariants. Une spec dédiée valide le
 *     happy path pur (zero state préalable).
 *   - Anti-régression directe du bug 2026-05-23 "MissingCSRF" si
 *     l'agent retombe sur un POST manuel /api/auth/callback/credentials
 *     (sans signIn() client) → cookie csrf manquant → callback 500.
 */
import { test, expect } from "@playwright/test";
import {
  ensureCanonicalUser,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
} from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Flow cross-app — Login Credentials direct", () => {
  test("form /login → signIn credentials → session + /prospects", async ({
    browser,
  }) => {
    test.skip(
      !process.env.DATABASE_URL,
      "DATABASE_URL requise pour seed canonique",
    );
    await ensureCanonicalUser();

    // Fresh context — pas de cookie pré-existant
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto(`${PROSPECTION_URL}/login`);
    await expect(page.getByText(/connectez-vous|prospection/i).first()).toBeVisible();

    // Remplit le form. getByLabel cible précisément les inputs (cf
    // critical-journeys.spec.ts § Auth.js v5 pattern).
    await page.getByLabel("Email", { exact: true }).fill(E2E_USER_EMAIL);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(E2E_USER_PASSWORD);
    await page.getByRole("button", { name: /se connecter/i }).click();

    // Auth.js redirige vers /prospects en cas de succès
    await page.waitForURL(/\/prospects/, { timeout: 25_000 });

    // Cookie session posé (HTTPS → __Secure-, HTTP → plain)
    const cookies = await ctx.cookies();
    const sessionCookie = cookies.find((c) =>
      /authjs\.session-token/.test(c.name),
    );
    expect(sessionCookie, "cookie session manquant après login").toBeDefined();
    expect(sessionCookie!.httpOnly).toBe(true);

    // /api/auth/session retourne le user canonique
    const sessionRes = await page.request.get(`${PROSPECTION_URL}/api/auth/session`);
    expect(sessionRes.status()).toBe(200);
    const session = (await sessionRes.json()) as {
      user?: { email?: string; id?: string };
    };
    expect(session.user?.email?.toLowerCase()).toBe(
      E2E_USER_EMAIL.toLowerCase(),
    );
    expect(session.user?.id).toBeTruthy();

    // Page /prospects rend sans rebond /login (middleware Auth.js OK)
    await expect(page).toHaveURL(/\/prospects/);

    await ctx.close();
  });
});
