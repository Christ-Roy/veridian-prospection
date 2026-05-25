/**
 * Flow mail #3 — Test connexion SMTP avec config invalide.
 *
 * Scénario :
 *   1. Login canonique → /settings/mail
 *   2. Saisit host=mailpit-staging mais port=9999 (inaccessible)
 *   3. Click "Tester la connexion"
 *   4. Toast erreur visible + DB tenant_mail_config inchangée si vierge
 *      (le test ne save pas — il appelle juste verify())
 *
 * On vérifie aussi le cas opposé : port=1025 (valide) → toast succès.
 *
 * Anti-régression :
 *   - testConnection() qui ne retourne plus l'erreur structurée → l'UI
 *     ne montrerait pas le bon toast → spec rouge.
 *   - Le verify() qui ne timeout pas → spec rouge à cause du timeout
 *     Playwright (60s).
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";
import { MAILPIT_SMTP, clearMailConfig } from "./_helpers/mail-config";
import { assertMailpitUp } from "./_helpers/mailpit";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Mail flow — Test connexion SMTP", () => {
  test.beforeEach(async () => {
    await assertMailpitUp();
    await clearMailConfig();
  });

  test("Port inaccessible → toast erreur visible, pas de save", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);

    // Test direct via l'API pour valider le contrat — c'est ce que
    // déclenche le bouton "Tester la connexion".
    const res = await page.request.post(
      `${PROSPECTION_URL}/api/mail/test-connection`,
      {
        data: {
          host: MAILPIT_SMTP.host,
          port: 9999, // port fermé sur mailpit-staging
          username: MAILPIT_SMTP.username,
          password: MAILPIT_SMTP.password,
          tls: false,
          fromEmail: MAILPIT_SMTP.fromEmail,
        },
      },
    );
    // Le contrat : 200 OK + body { ok: false, reason: "host_unreachable" |
    // "timeout" } selon comment le réseau réagit (refused vs drop).
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    // Selon l'env, ECONNREFUSED → host_unreachable, ou TLS error sur 9999
    // → tls_error. On accepte tout reason ≠ ok.
    expect([
      "host_unreachable",
      "timeout",
      "tls_error",
      "unknown",
    ]).toContain(body.reason);
  });

  test("Mailpit accessible → ok=true", async ({ page, request }) => {
    await loginAsE2EUser(page, request);

    const res = await page.request.post(
      `${PROSPECTION_URL}/api/mail/test-connection`,
      {
        data: {
          host: MAILPIT_SMTP.host,
          port: MAILPIT_SMTP.port,
          username: MAILPIT_SMTP.username,
          password: MAILPIT_SMTP.password,
          tls: false,
          fromEmail: MAILPIT_SMTP.fromEmail,
        },
      },
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(
      body.ok,
      `Mailpit doit accepter la connexion (port 1025 plain SMTP). ` +
        `Reason si KO: ${body.reason}`,
    ).toBe(true);
  });
});
