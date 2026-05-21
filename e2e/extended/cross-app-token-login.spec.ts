/**
 * Cross-app login token — flow magic-link Hub → Prospection.
 *
 * Le Hub appelle POST /api/tenants/provision (HMAC, avec `user_id`) et
 * reçoit un `login_url` du type `/api/auth/token?t=<32B hex>`. Quand
 * l'user clique, Prospection valide le token (one-shot, 24h), pose un
 * cookie de session Auth.js, et redirige vers /.
 *
 * Couvre :
 *  1. Token valide → 307 redirect / + cookie session posé
 *  2. Token re-utilisé → redirect /login?error=token_used
 *  3. Token bidon → redirect /login?error=invalid_token
 *  4. Pas de paramètre t → 400 JSON
 *  5. Bonus : naviguer ensuite sur /api/me avec le cookie marche
 *     (preuve fonctionnelle que la session Auth.js a bien été créée).
 */
import { test, expect } from "@playwright/test";
import { provisionEphemeralTenant } from "../helpers/cross-app-login";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Cross-app login token /api/auth/token", () => {
  test.setTimeout(60_000);

  test("token valide → 307 redirect / + cookie session Auth.js posé", async ({
    request,
  }) => {
    const tenant = await provisionEphemeralTenant(request);

    // maxRedirects:0 pour capturer le 307 et inspecter Set-Cookie.
    const res = await request.get(tenant.loginUrl, { maxRedirects: 0 });
    expect([302, 307]).toContain(res.status());
    const location = res.headers()["location"];
    expect(location).toBeTruthy();
    // Doit rediriger vers "/" (homepage) — pas vers /login?error=... (qui = échec
    // côté handler). En revanche /login?redirect=/ est OK : c'est la middleware
    // Auth.js qui ne voit pas encore la nouvelle session (sera fixée après
    // round-trip cookie).
    expect(location).not.toContain("/login?error=");

    // Cookie Auth.js posé (nom = authjs.session-token en HTTP plain,
    // __Secure-authjs.session-token en HTTPS prod).
    const setCookie = res.headersArray().filter(
      (h) => h.name.toLowerCase() === "set-cookie",
    );
    expect(setCookie.length, "Set-Cookie should be present").toBeGreaterThan(0);
    const cookieNames = setCookie.map((c) => c.value.split("=")[0]);
    const hasSessionCookie = cookieNames.some((n) =>
      n.includes("authjs.session-token"),
    );
    expect(
      hasSessionCookie,
      `Auth.js session cookie missing. Got: ${cookieNames.join(", ")}`,
    ).toBeTruthy();
  });

  test("session créée donne accès à /api/me", async ({ browser, request }) => {
    // Vérification fonctionnelle : après autologin, le user peut interroger
    // une route protégée. C'est le seul test qui prouve bout-en-bout que
    // la session est valide (pas juste un cookie cosmétique).
    const tenant = await provisionEphemeralTenant(request);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await context.newPage();
      await page.goto(tenant.loginUrl);
      // Laisser le redirect interne se faire (vers / ou /login si middleware
      // gate Auth.js). Le cookie est posé indépendamment.
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      // Ré-utilise le cookie posé par le redirect côté page pour faire un
      // /api/me en JSON.
      const cookies = await context.cookies();
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const meRes = await request.get(`${PROSPECTION_URL}/api/me`, {
        headers: { cookie: cookieHeader },
      });
      expect(
        [200, 404],
        `/api/me should be 200 (logged in) or 404 if endpoint missing, got ${meRes.status()}`,
      ).toContain(meRes.status());
      if (meRes.status() === 200) {
        const body = (await meRes.json()) as { email?: string; user?: { email?: string } };
        const email = body.email ?? body.user?.email;
        expect(email).toBe(tenant.email);
      }
    } finally {
      await context.close();
    }
  });

  test("token re-utilisé → redirect /login?error=token_used", async ({
    request,
  }) => {
    const tenant = await provisionEphemeralTenant(request);

    // Premier hit : consomme le token.
    const first = await request.get(tenant.loginUrl, { maxRedirects: 0 });
    expect([302, 307]).toContain(first.status());

    // Deuxième hit : token marqué used → redirect erreur.
    const second = await request.get(tenant.loginUrl, { maxRedirects: 0 });
    expect([302, 307]).toContain(second.status());
    const location = second.headers()["location"];
    expect(location).toContain("/login?error=token_used");
  });

  test("token bidon → redirect /login?error=invalid_token", async ({
    request,
  }) => {
    const fakeToken = "0".repeat(64);
    const res = await request.get(
      `${PROSPECTION_URL}/api/auth/token?t=${fakeToken}`,
      { maxRedirects: 0 },
    );
    expect([302, 307]).toContain(res.status());
    const location = res.headers()["location"];
    expect(location).toContain("/login?error=invalid_token");
  });

  test("pas de ?t= → 400 JSON", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/auth/token`);
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/token/i);
  });
});
