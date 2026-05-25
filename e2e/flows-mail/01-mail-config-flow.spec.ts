/**
 * Flow mail #1 — Configuration SMTP via /settings/mail.
 *
 * Scénario :
 *   1. Login canonique → /settings/mail
 *   2. Le form est vide (pas de config encore)
 *   3. Remplit host=mailpit-staging, port=1025, TLS off, from=e2e@…
 *   4. Save → toast "sauvegardée"
 *   5. Vérifie en DB :
 *      - tenant_mail_config row créée
 *      - smtp_password_enc non null + chiffré (3 parts séparés par `:`)
 *      - host/port/username persistés
 *
 * Anti-régression :
 *   - Si l'API PUT casse silencieusement (rateLimit, validation), pas de
 *     row en DB → spec rouge.
 *   - Si le password est stocké en clair (régression crypto), le format
 *     du smtp_password_enc ne match plus `iv:tag:ct` → spec rouge.
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";
import { MAILPIT_SMTP, clearMailConfig, readMailConfig } from "./_helpers/mail-config";
import { assertMailpitUp } from "./_helpers/mailpit";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Mail flow — Configuration SMTP", () => {
  test.beforeEach(async () => {
    await assertMailpitUp();
    await clearMailConfig();
  });

  test("admin configure SMTP via /settings/mail → row chiffrée en DB", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);

    await page.goto(`${PROSPECTION_URL}/settings/mail`);
    await page.waitForSelector("input#host", { timeout: 15_000 });

    // Le form doit être vide après clearMailConfig (pré-condition stricte).
    const hostInput = page.locator("input#host");
    await expect(hostInput).toHaveValue("");

    // Remplit la config mailpit.
    await hostInput.fill(MAILPIT_SMTP.host);
    await page.locator("input#port").fill(String(MAILPIT_SMTP.port));
    await page.locator("input#username").fill(MAILPIT_SMTP.username);
    await page.locator("input#password").fill(MAILPIT_SMTP.password);
    await page.locator("input#fromEmail").fill(MAILPIT_SMTP.fromEmail);
    await page.locator("input#fromName").fill(MAILPIT_SMTP.fromName ?? "");

    // TLS off pour mailpit (port 1025 plain SMTP). La checkbox est cochée
    // par défaut — on la décoche si nécessaire.
    const tlsBox = page.locator("button#tls, input#tls");
    const isChecked = await tlsBox
      .first()
      .getAttribute("aria-checked")
      .catch(() => null);
    if (isChecked === "true") {
      await tlsBox.first().click();
    }

    // Save (le bouton "Sauvegarder" qui n'est PAS "Tester la connexion").
    await page.getByRole("button", { name: /sauvegarder/i }).click();

    // Toast succès. On polle un peu (Sonner peut prendre 200-500ms).
    await expect(page.locator("text=Configuration SMTP sauvegardée")).toBeVisible({
      timeout: 5_000,
    });

    // Vérifie la DB.
    const row = await readMailConfig();
    expect(row, "tenant_mail_config row doit exister après save").not.toBeNull();
    expect(row!.smtpHost).toBe(MAILPIT_SMTP.host);
    expect(row!.smtpPort).toBe(MAILPIT_SMTP.port);
    expect(row!.smtpUsername).toBe(MAILPIT_SMTP.username);
    expect(row!.smtpFromEmail).toBe(MAILPIT_SMTP.fromEmail);

    // Crypto : le password ne doit pas être en clair, et doit suivre le
    // format `<iv>:<tag>:<ciphertext>` (3 parts séparés par `:`).
    expect(row!.smtpPasswordEnc).not.toBeNull();
    expect(row!.smtpPasswordEnc).not.toBe(MAILPIT_SMTP.password);
    expect(row!.smtpPasswordEnc).not.toContain(MAILPIT_SMTP.password);
    const parts = (row!.smtpPasswordEnc ?? "").split(":");
    expect(
      parts.length,
      `smtpPasswordEnc doit avoir 3 parts (iv:tag:ciphertext), got ${parts.length}`,
    ).toBe(3);
    expect(parts.every((p) => p.length > 0)).toBe(true);
  });
});
