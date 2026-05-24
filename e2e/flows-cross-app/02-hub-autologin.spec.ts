/**
 * Flow cross-app #2 — Login Hub → Prospection (autologin via token HMAC).
 *
 * Couvre le contrat §5 (CONTRAT-HUB) :
 *  Hub appelle POST /api/tenants/provision (HMAC) → Prosp génère un
 *  loginToken random, renvoie un login_url one-shot. Le browser ouvre
 *  /api/auth/token?t=<token> → cookie session Auth.js posé + redirect
 *  /prospects.
 *
 * Diffère du critical-journeys staging-full SSO : ici on cible un USER
 * BRAND NEW (UUID Hub aléatoire généré pour la run) — on valide que la
 * provision crée le tenant ex nihilo, pas qu'elle re-recycle un tenant
 * pré-existant côté Robert.
 *
 * Anti-régression :
 *  - Si le token n'est plus persisté (refacto loupé sur le champ
 *    `prospectionLoginToken`), `/api/auth/token` renvoie invalid_token
 *    → la spec rougit.
 *  - Si l'HMAC change de format (timestamp.body order, header), la
 *    provision elle-même retourne 401 → la spec rougit en <5s.
 */
import { test, expect } from "@playwright/test";
import { provisionEphemeralTenant } from "../helpers/cross-app-login";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Flow cross-app — Hub autologin", () => {
  test("provision HMAC → /api/auth/token → session valide → /prospects", async ({
    request,
    browser,
  }) => {
    // 1) Hub provisionne un tenant (HMAC signé) — login_url one-shot retourné
    const tenant = await provisionEphemeralTenant(request);
    expect(tenant.loginUrl).toMatch(/\/api\/auth\/token\?t=[a-f0-9]{32,}$/);

    // 2) Fresh BrowserContext (aucun cookie pré-existant)
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(tenant.loginUrl);

    // 3) Doit rediriger hors de /api/auth/token (success → / ou /prospects)
    await page.waitForURL(
      (url) => !url.toString().includes("/api/auth/token"),
      { timeout: 15_000 },
    );
    expect(page.url(), "redirect inattendue vers /login?error=").not.toContain(
      "/login?error=",
    );

    // 4) Cookie session posé (Lax + HttpOnly + Secure en HTTPS)
    const cookies = await ctx.cookies();
    const sessionCookie = cookies.find((c) =>
      /authjs\.session-token/.test(c.name),
    );
    expect(sessionCookie, "cookie session manquant").toBeDefined();
    expect(sessionCookie!.httpOnly).toBe(true);

    // 5) /api/auth/session retourne le user — email = celui du provision body
    const sessionRes = await page.request.get(`${PROSPECTION_URL}/api/auth/session`);
    expect(sessionRes.status()).toBe(200);
    const session = (await sessionRes.json()) as {
      user?: { email?: string; id?: string };
    };
    expect(session.user?.email?.toLowerCase()).toBe(tenant.email.toLowerCase());
    expect(session.user?.id).toBeTruthy();

    // 6) /prospects accessible avec cette session
    await page.goto(`${PROSPECTION_URL}/prospects`);
    await expect(page).toHaveURL(/\/prospects/, { timeout: 10_000 });

    // 7) Replay du même token → token_used (one-shot strict)
    const replayRes = await ctx.request.get(tenant.loginUrl, {
      maxRedirects: 0,
    });
    const location = replayRes.headers()["location"] ?? "";
    expect(location, `replay should redirect to error: ${location}`).toContain(
      "token_used",
    );

    await ctx.close();
  });
});
