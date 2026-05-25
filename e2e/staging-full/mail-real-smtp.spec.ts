/**
 * Smoke contractuel mail v1 — envoi réel via SMTP externe (Brevo / Lark).
 *
 * Tourne avec la suite staging-full (§20.6 — exécution headfull avant
 * promo tier 🔴+). Skip si pas de credentials SMTP réels en env — utile
 * en local sans creds, mais OBLIGATOIRE de fournir les creds avant
 * promo prod.
 *
 * Différence avec les flows-mail (qui visent mailpit) :
 *   - mailpit est un mock — il accepte tout, ne reject jamais, n'a pas
 *     de DKIM/SPF/anti-spam. Un mail qui passe mailpit peut totalement
 *     se faire bouncer par Gmail ou Outlook.
 *   - ce smoke envoie un VRAI mail via SMTP (Lark ici), vers une boite
 *     gérée par Robert, qu'on inspecte via IMAP pour confirmer la
 *     réception.
 *
 * Pourquoi c'est essentiel :
 *   - valide la chaîne SMTP réelle : TLS, STARTTLS, auth, queue
 *   - valide qu'aucun header généré (From, Message-Id) ne déclenche un
 *     reject côté MTA
 *   - valide la résilience au timeout réseau (vs Mailpit qui est en local
 *     du container Playwright)
 *
 * Variables d'env utilisées :
 *   REAL_SMTP_HOST, REAL_SMTP_PORT, REAL_SMTP_USER, REAL_SMTP_PASSWORD,
 *   REAL_SMTP_FROM_EMAIL : la config SMTP du tenant E2E pour ce smoke
 *   REAL_SMTP_RECIPIENT  : adresse destinataire à inspecter
 *
 * Optionnellement (si on veut vraiment vérifier la livraison via IMAP) :
 *   REAL_IMAP_HOST, REAL_IMAP_USER, REAL_IMAP_PASSWORD (lib `imapflow`
 *   non encore en deps v1 — la vérif IMAP est un follow-up v2).
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";
import { seedMailConfig, purgeLeadEmails, lastLeadEmail } from "../flows-mail/_helpers/mail-config";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

const SMTP_HOST = process.env.REAL_SMTP_HOST;
const SMTP_PORT = process.env.REAL_SMTP_PORT;
const SMTP_USER = process.env.REAL_SMTP_USER;
const SMTP_PASS = process.env.REAL_SMTP_PASSWORD;
const SMTP_FROM = process.env.REAL_SMTP_FROM_EMAIL;
const RECIPIENT =
  process.env.REAL_SMTP_RECIPIENT || "robert.brunon+e2e-prospection@gmail.com";

const hasCreds = !!(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM);

test.describe("Smoke contractuel SMTP réel (bonus)", () => {
  test.skip(
    !hasCreds,
    "REAL_SMTP_* manquant — smoke contractuel skippé. Pour l'activer, " +
      "exporter REAL_SMTP_HOST, REAL_SMTP_PORT, REAL_SMTP_USER, " +
      "REAL_SMTP_PASSWORD, REAL_SMTP_FROM_EMAIL avant de lancer la suite.",
  );

  test("envoi réel via SMTP externe → row sent + messageId présent", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000); // SMTP réel peut prendre 30+s sur cold path.

    await loginAsE2EUser(page, request);
    await purgeLeadEmails();
    await seedMailConfig(page, PROSPECTION_URL, {
      host: SMTP_HOST!,
      port: Number(SMTP_PORT!),
      username: SMTP_USER!,
      password: SMTP_PASS!,
      tls: true,
      fromEmail: SMTP_FROM!,
      fromName: "Veridian Prospection E2E",
    });

    const res = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: RECIPIENT,
        siren: "900000001",
        subject: `[E2E-smoke] Veridian Prospection ${new Date().toISOString()}`,
        bodyText:
          "Mail de smoke contractuel — si tu vois ceci dans ta boîte, " +
          "la chaîne SMTP Veridian Prospection v1 marche bout-en-bout.",
        bodyHtml:
          "<p>Mail de smoke contractuel — si tu vois ceci dans ta boîte, " +
          "la chaîne SMTP Veridian Prospection v1 marche bout-en-bout.</p>",
      },
    });

    const body = (await res.json()) as {
      ok: boolean;
      reason?: string;
      errorMessage?: string;
      messageId?: string;
    };

    expect(
      res.status(),
      `POST /api/mail/send a renvoyé ${res.status()} (reason=${body.reason}, ` +
        `err=${body.errorMessage})`,
    ).toBe(200);
    expect(body.ok, `Envoi SMTP réel KO: reason=${body.reason}`).toBe(true);
    expect(body.messageId).toBeTruthy();

    // Row lead_emails crée avec sent.
    const row = await lastLeadEmail();
    expect(row!.sentStatus).toBe("sent");
    expect(row!.messageId).toBe(body.messageId);
    expect(row!.sentError).toBeNull();

    // NB : la vérif IMAP que le mail est BIEN ARRIVÉ chez Robert est un
    // follow-up v2 (`imapflow` à ajouter en deps). v1 = trust SMTP =200.
  });
});
