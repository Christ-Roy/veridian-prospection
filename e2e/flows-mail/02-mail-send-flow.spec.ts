/**
 * Flow mail #2 — Envoi mail bout-en-bout (UI cookie → API → mailpit → DB).
 *
 * Scénario :
 *   1. Login canonique
 *   2. Seed config SMTP mailpit (PUT /api/mail/config)
 *   3. POST /api/mail/send avec template "relance-commerciale-v1" et vars
 *      prospect {name: "Alice Martin", entreprise: "Acme SAS"}
 *   4. Vérifie mailpit a reçu le mail (poll /api/v1/messages)
 *   5. Vérifie row lead_emails créée (sentStatus=sent, messageId présent,
 *      template_slug correct, body rendu sans `{{ }}`)
 *
 * On passe par l'API (`request.post`) plutôt que par la modale UI pour
 * deux raisons :
 *   - Le bouton "Envoyer un mail" dans la fiche lead n'apparaît que si un
 *     email est dispo via `dirigeant_email`/`emails` — non garanti sur le
 *     lead canonique. La spec 04-mail-template-rendering teste la chaîne
 *     UI complète (rendering avec vars), c'est suffisant.
 *   - Le contrat critique est /api/mail/send, pas le rendu de la modale.
 *
 * Anti-régression :
 *   - sendMail() qui ne ferait plus de transporter.sendMail() → mailpit
 *     reste vide → rouge.
 *   - Crypto qui ne déchiffre pas le password → SendResult { ok: false,
 *     reason: "decrypt_failed" } → row lead_emails.sentStatus=failed → rouge.
 *   - Liquid render désactivé → body contient `{{ prospect.name }}` → rouge.
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";
import {
  seedMailConfig,
  purgeLeadEmails,
  lastLeadEmail,
} from "./_helpers/mail-config";
import {
  assertMailpitUp,
  purgeMailbox,
  waitForMessageTo,
} from "./_helpers/mailpit";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

const RECIPIENT = "alice-acme@yopmail.com";

test.describe("Mail flow — Envoi mail bout-en-bout", () => {
  test.beforeEach(async () => {
    await assertMailpitUp();
    await purgeMailbox();
    await purgeLeadEmails();
  });

  test("POST /api/mail/send (template) → mailpit reçoit + lead_emails sent", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL);

    // On tape l'API via `page.request` qui hérite des cookies du
    // BrowserContext (notamment `authjs.session-token` posé par
    // loginAsE2EUser). L'APIRequestContext du fixture `request` est un
    // context isolé sans cookies → 401.
    const send = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: RECIPIENT,
        siren: "900000001",
        templateSlug: "relance-commerciale-v1",
        vars: {
          prospect: { name: "Alice Martin", entreprise: "Acme SAS" },
        },
      },
    });

    expect(
      send.status(),
      `POST /api/mail/send a échoué body=${await send.text().catch(() => "n/a")}`,
    ).toBe(200);
    const sendBody = (await send.json()) as { ok: boolean; messageId?: string };
    expect(sendBody.ok).toBe(true);
    expect(sendBody.messageId).toBeTruthy();

    // 1) Mailpit reçoit le mail.
    const msg = await waitForMessageTo(RECIPIENT, { timeoutMs: 15_000 });
    expect(msg.Subject).toContain("Acme SAS");
    expect(msg.Text).toContain("Alice Martin");
    expect(msg.Text).toContain("Acme SAS");
    expect(msg.HTML).toContain("Alice Martin");
    // Pas de variable liquid résiduelle.
    expect(msg.Text).not.toMatch(/\{\{/);
    expect(msg.HTML).not.toMatch(/\{\{/);

    // 2) Row lead_emails créée avec status=sent.
    const row = await lastLeadEmail();
    expect(row, "lead_email row doit exister").not.toBeNull();
    expect(row!.sentStatus).toBe("sent");
    expect(row!.templateSlug).toBe("relance-commerciale-v1");
    expect(row!.messageId).toBe(sendBody.messageId);
    expect(row!.toEmails).toContain(RECIPIENT);
    expect(row!.subject).toContain("Acme SAS");
    expect(row!.bodyText).toContain("Alice Martin");
    expect(row!.bodyText).not.toMatch(/\{\{/);
    expect(row!.sentError).toBeNull();
  });
});
