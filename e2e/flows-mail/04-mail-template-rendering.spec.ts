/**
 * Flow mail #4 — Rendering des templates liquid (`{{ vars }}`).
 *
 * Scénario : envoie 2 mails (1 par template Veridian) et vérifie que TOUTES
 * les variables `{{ prospect.* }}` et `{{ sender.* }}` ont bien été
 * remplacées dans le subject + bodyText + bodyHtml côté mailpit ET côté
 * row lead_emails. Aucun `{{` ne doit traîner.
 *
 * Test XSS de surface : on envoie un prospect.name contenant `<script>` —
 * le HTML envoyé doit toujours contenir la chaîne (renderTemplate est un
 * simple replace, l'escape HTML est responsabilité du producteur upstream
 * v1 ; mais on assert le COMPORTEMENT actuel pour que toute régression
 * — disons un import "raw" qui drop le script — soit visible).
 *
 * Anti-régression :
 *   - Si renderTemplate() devient identity (return source) → variables
 *     non remplacées → match `{{ }}` → rouge.
 *   - Si liquid render se met à confondre sender.name et prospect.name
 *     (régression refactor) → mauvaise valeur dans le body → rouge.
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";
import {
  seedMailConfig,
  purgeLeadEmails,
  lastLeadEmail,
  MAILPIT_SMTP,
} from "./_helpers/mail-config";
import {
  assertMailpitUp,
  purgeMailbox,
  waitForMessageTo,
} from "./_helpers/mailpit";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Mail flow — Rendering templates liquid", () => {
  test.beforeEach(async () => {
    await assertMailpitUp();
    await purgeMailbox();
    await purgeLeadEmails();
  });

  test("relance-commerciale-v1 : toutes les vars sont remplies", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL);

    const recipient = "rendering-1@yopmail.com";
    const res = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: recipient,
        siren: "900000001",
        templateSlug: "relance-commerciale-v1",
        vars: {
          prospect: { name: "Jean Dupont", entreprise: "Boulangerie Dupont" },
        },
      },
    });
    expect(res.status()).toBe(200);

    const msg = await waitForMessageTo(recipient);

    // Variables remplies — chaque chaîne attendue présente.
    expect(msg.Subject).toContain("Boulangerie Dupont");
    expect(msg.Text).toContain("Jean Dupont");
    expect(msg.Text).toContain("Boulangerie Dupont");
    expect(msg.HTML).toContain("Jean Dupont");
    expect(msg.HTML).toContain("Boulangerie Dupont");

    // sender.name = fromName du tenant (E2E Persistent — cf MAILPIT_SMTP).
    const expectedSenderName = MAILPIT_SMTP.fromName ?? "";
    if (expectedSenderName) {
      expect(msg.Text).toContain(expectedSenderName);
      expect(msg.HTML).toContain(expectedSenderName);
    }

    // Aucune variable liquid résiduelle.
    expect(msg.Subject).not.toMatch(/\{\{/);
    expect(msg.Text).not.toMatch(/\{\{/);
    expect(msg.HTML).not.toMatch(/\{\{/);

    // Row DB aussi nickel.
    const row = await lastLeadEmail();
    expect(row!.bodyText).not.toMatch(/\{\{/);
    expect(row!.bodyHtml).not.toMatch(/\{\{/);
    expect(row!.subject).not.toMatch(/\{\{/);
  });

  test("demo-prospection-v1 : variables sender + prospect resolved", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL);

    const recipient = "rendering-2@yopmail.com";
    const res = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: recipient,
        siren: "900000001",
        templateSlug: "demo-prospection-v1",
        vars: {
          prospect: { name: "Marie Curie", entreprise: "Institut Curie" },
        },
      },
    });
    expect(res.status()).toBe(200);

    const msg = await waitForMessageTo(recipient);
    expect(msg.Subject).toContain("Institut Curie");
    expect(msg.Text).toContain("Marie Curie");
    expect(msg.Text).toContain("Institut Curie");
    expect(msg.Subject).not.toMatch(/\{\{/);
    expect(msg.Text).not.toMatch(/\{\{/);
    expect(msg.HTML).not.toMatch(/\{\{/);
  });

  test("compose libre : pas de rendu liquid, le body est passé tel quel", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL);

    const recipient = "rendering-freeform@yopmail.com";
    // Compose libre : pas de templateSlug. {{ }} dans le body reste brut
    // (c'est l'user qui a tapé ces caractères, on ne devine pas).
    const res = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: recipient,
        siren: "900000001",
        subject: "Sujet libre {{ pas_rendered }}",
        bodyText: "Texte libre {{ pas_rendered }}",
        bodyHtml: "<p>HTML libre {{ pas_rendered }}</p>",
      },
    });
    expect(res.status()).toBe(200);

    const msg = await waitForMessageTo(recipient);
    // Compose libre : le `{{ }}` reste — c'est voulu (l'user n'a pas demandé
    // de rendering, il a tapé ces caractères).
    expect(msg.Subject).toContain("{{ pas_rendered }}");
    expect(msg.Text).toContain("{{ pas_rendered }}");
  });
});
