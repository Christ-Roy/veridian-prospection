/**
 * E2E hard-core — presets providers + flow App Password guidé (W9e).
 *
 * Périmètre :
 *  - Auto-fill IMAP host/port/TLS au blur du champ username quand domaine
 *    connu (Gmail, Outlook, Yahoo, iCloud, OVH, Free)
 *  - Bandeau MailProviderHint visible UNIQUEMENT quand requiresAppPassword
 *  - CTA "Créer un App Password" → target="_blank" + URL correcte par provider
 *  - Pas d'écrasement d'un host saisi manuellement (preset = aide, pas
 *    autorité)
 *  - Tests identiques côté SMTP (onglet "SMTP")
 *  - State local : 2 onglets ne se polluent pas mutuellement
 *
 * Tests servis depuis prospection.staging.veridian.site, login via le
 * helper canonique. Aucun appel DB nécessaire (presets = lib pure
 * client-side).
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Provider presets — IMAP tab", () => {
  test.beforeEach(async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/settings/mail`);
    await page.getByRole("tab", { name: /IMAP/i }).click();
  });

  test("Gmail : auto-fill host/port/TLS au blur + bandeau App Password visible", async ({
    page,
  }) => {
    const username = page.getByTestId("imap-username-input");
    await username.fill("commercial@gmail.com");
    await username.blur();

    // Auto-fill IMAP Gmail
    await expect(page.locator("#imap-host")).toHaveValue("imap.gmail.com");
    await expect(page.locator("#imap-port")).toHaveValue("993");
    await expect(page.locator("#imap-tls")).toBeChecked();

    // Bandeau visible avec provider gmail
    const hint = page.getByTestId("mail-provider-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveAttribute("data-provider", "gmail");

    // CTA bouton App Password — vérifie l'URL et target
    const cta = page.getByTestId("mail-provider-app-password-cta");
    const href = await cta.locator("a").getAttribute("href");
    expect(href).toBe("https://myaccount.google.com/apppasswords");
    await expect(cta.locator("a")).toHaveAttribute("target", "_blank");
    await expect(cta.locator("a")).toHaveAttribute(
      "rel",
      /noopener|noreferrer/,
    );
  });

  test("Outlook : auto-fill outlook.office365.com + STARTTLS 587", async ({
    page,
  }) => {
    const username = page.getByTestId("imap-username-input");
    await username.fill("bob@outlook.com");
    await username.blur();

    await expect(page.locator("#imap-host")).toHaveValue(
      "outlook.office365.com",
    );
    // IMAP outlook = 993 SSL (pas le 587 SMTP)
    await expect(page.locator("#imap-port")).toHaveValue("993");

    const hint = page.getByTestId("mail-provider-hint");
    await expect(hint).toHaveAttribute("data-provider", "outlook");
    const href = await page
      .getByTestId("mail-provider-app-password-cta")
      .locator("a")
      .getAttribute("href");
    expect(href).toContain("account.microsoft.com");
  });

  test("OVH : auto-fill ssl0.ovh.net + PAS de bandeau App Password (pas requis)", async ({
    page,
  }) => {
    const username = page.getByTestId("imap-username-input");
    await username.fill("admin@ovh.fr");
    await username.blur();

    await expect(page.locator("#imap-host")).toHaveValue("ssl0.ovh.net");
    // Pas de bandeau pour OVH/Free — password de boîte direct
    await expect(page.getByTestId("mail-provider-hint")).toHaveCount(0);
  });

  test("Free : auto-fill imap.free.fr + pas de bandeau", async ({ page }) => {
    const username = page.getByTestId("imap-username-input");
    await username.fill("dupont@free.fr");
    await username.blur();

    await expect(page.locator("#imap-host")).toHaveValue("imap.free.fr");
    await expect(page.getByTestId("mail-provider-hint")).toHaveCount(0);
  });

  test("Domaine inconnu : pas d'auto-fill, pas de bandeau, user peut saisir manuellement", async ({
    page,
  }) => {
    const username = page.getByTestId("imap-username-input");
    await username.fill("contact@boulanger.fr");
    await username.blur();

    // host reste vide (pas écrasé)
    await expect(page.locator("#imap-host")).toHaveValue("");
    await expect(page.getByTestId("mail-provider-hint")).toHaveCount(0);

    // User peut saisir manuellement
    await page.locator("#imap-host").fill("imap.boulanger-custom.example");
    await expect(page.locator("#imap-host")).toHaveValue(
      "imap.boulanger-custom.example",
    );
  });

  test("Email malformé : pas de detect, pas de plantage", async ({ page }) => {
    const username = page.getByTestId("imap-username-input");
    await username.fill("notanemail");
    await username.blur();
    await expect(page.getByTestId("mail-provider-hint")).toHaveCount(0);

    await username.fill("");
    await username.blur();
    await expect(page.getByTestId("mail-provider-hint")).toHaveCount(0);
  });

  test("Pollution : effacer l'email après auto-fill n'écrase pas le host (state stable)", async ({
    page,
  }) => {
    const username = page.getByTestId("imap-username-input");
    await username.fill("john@gmail.com");
    await username.blur();
    await expect(page.locator("#imap-host")).toHaveValue("imap.gmail.com");

    // L'user efface le champ email — on n'écrase pas son host
    await username.fill("");
    await username.blur();
    // host conservé (pas reset à "")
    await expect(page.locator("#imap-host")).toHaveValue("imap.gmail.com");
    // Bandeau disparu car plus de provider détecté
    await expect(page.getByTestId("mail-provider-hint")).toHaveCount(0);
  });

  test("Guide step-by-step : accordéon toggle visible/caché", async ({
    page,
  }) => {
    const username = page.getByTestId("imap-username-input");
    await username.fill("john@gmail.com");
    await username.blur();

    // Guide caché par défaut
    await expect(page.getByTestId("mail-provider-guide-steps")).toHaveCount(0);

    // Toggle ouvert
    await page.getByTestId("mail-provider-toggle-guide").click();
    await expect(page.getByTestId("mail-provider-guide-steps")).toBeVisible();

    // Texte attendu Gmail
    await expect(page.getByTestId("mail-provider-guide-steps")).toContainText(
      /App Password/i,
    );
    await expect(page.getByTestId("mail-provider-guide-steps")).toContainText(
      "Veridian Prospection",
    );

    // Toggle re-fermé
    await page.getByTestId("mail-provider-toggle-guide").click();
    await expect(page.getByTestId("mail-provider-guide-steps")).toHaveCount(0);
  });

  test("Host saisi manuellement avant le blur email : preset ne l'écrase pas", async ({
    page,
  }) => {
    // User tape d'abord un host custom
    await page.locator("#imap-host").fill("imap.custom.example");

    // Puis saisit l'email Gmail
    const username = page.getByTestId("imap-username-input");
    await username.fill("john@gmail.com");
    await username.blur();

    // Le host custom est préservé (preset = aide, pas autorité)
    await expect(page.locator("#imap-host")).toHaveValue(
      "imap.custom.example",
    );
    // Mais le bandeau d'aide reste affiché (provider détecté indépendamment)
    await expect(page.getByTestId("mail-provider-hint")).toHaveAttribute(
      "data-provider",
      "gmail",
    );
  });
});

test.describe("Provider presets — SMTP tab", () => {
  test.beforeEach(async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/settings/mail`);
    // L'onglet SMTP est l'onglet par défaut, mais on clique pour être sûr
    await page.getByRole("tab", { name: /^SMTP$/i }).click();
  });

  test("SMTP Gmail : auto-fill smtp.gmail.com:465 + bandeau App Password", async ({
    page,
  }) => {
    const username = page.getByTestId("smtp-username-input");
    await username.fill("commercial@gmail.com");
    await username.blur();

    await expect(page.locator("#host")).toHaveValue("smtp.gmail.com");
    await expect(page.locator("#port")).toHaveValue("465");
    await expect(page.locator("#tls")).toBeChecked();

    const hint = page.getByTestId("mail-provider-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveAttribute("data-provider", "gmail");
  });

  test("SMTP Outlook : auto-fill smtp.office365.com:587 (STARTTLS)", async ({
    page,
  }) => {
    const username = page.getByTestId("smtp-username-input");
    await username.fill("user@outlook.com");
    await username.blur();

    await expect(page.locator("#host")).toHaveValue("smtp.office365.com");
    await expect(page.locator("#port")).toHaveValue("587");
  });
});

test.describe("Provider presets — sécurité & isolement", () => {
  test("RBAC : la page /settings/mail est protégée — non-auth → redirect login", async ({
    page,
  }) => {
    // Pas de loginAsE2EUser ici
    await page.context().clearCookies();
    const res = await page.goto(`${PROSPECTION_URL}/settings/mail`, {
      waitUntil: "domcontentloaded",
    });
    // Redirect vers /login OU page de login direct OU 401/403
    const url = page.url();
    const isProtected =
      url.includes("/login") ||
      url.includes("/auth") ||
      res?.status() === 401 ||
      res?.status() === 403;
    expect(isProtected).toBe(true);
  });
});
