/**
 * E2E hard-core mail v1 improvements (W9c §A + §I + §J, livré 2026-05-25,
 * revert §F 2026-05-26).
 *
 * Périmètre :
 *  - A Templates customs CRUD : admin POST/PUT/DELETE → tenant_mail_templates
 *  - A Templates resolve : send avec un slug custom → corps custom utilisé
 *  - I Preview : POST /api/mail/render-preview rend les variables, détecte
 *    les non-substituées, applique signature optionnelle
 *  - J Signature : PUT /api/mail/signature → tenant_mail_config maj
 *  - J Signature : send avec signature enabled → mail contient signature
 *  - J Signature : send avec signature disabled → mail sans signature
 *
 * Mode envoi : **synchrone direct** depuis le revert §F (2026-05-26). Pas
 * de queue, /api/mail/send retourne 200 quand le SMTP a accepté.
 *
 * Le tenant E2E (e2e0e2e0-0000-4000-8000-000000000002) sert pour tout.
 */
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsE2EUser } from "../helpers/auth";
import {
  seedMailConfig,
  purgeLeadEmails,
  lastLeadEmail,
  MAILPIT_SMTP,
} from "../flows-mail/_helpers/mail-config";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";
const E2E_TENANT_ID = "e2e0e2e0-0000-4000-8000-000000000002";

let prismaSingleton: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
}

/** Purge tenant_mail_templates du tenant E2E. */
async function purgeTenantTemplates(): Promise<void> {
  const prisma = getPrisma();
  await prisma.tenantMailTemplate.deleteMany({
    where: { tenantId: E2E_TENANT_ID },
  });
}

/** Reset signature du tenant E2E. */
async function clearMailSignature(): Promise<void> {
  const prisma = getPrisma();
  await prisma.tenantMailConfig.updateMany({
    where: { tenantId: E2E_TENANT_ID },
    data: {
      mailSignatureHtml: null,
      mailSignatureEnabled: true,
    },
  });
}

test.describe("A — Templates customisables par tenant", () => {
  test.beforeEach(async () => {
    await purgeTenantTemplates();
    await purgeLeadEmails();
  });

  test("CRUD admin : create + list + update + soft-delete", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);

    // CREATE
    const createRes = await page.request.post(
      `${PROSPECTION_URL}/api/admin/mail-templates`,
      {
        data: {
          slug: "ma-relance-custom",
          label: "Ma relance custom",
          subject: "Suite à notre échange — {{ prospect.entreprise }}",
          bodyText: "Bonjour {{ prospect.name }}, voici mon contenu CUSTOM.",
          bodyHtml: "<p>Bonjour {{ prospect.name }}, contenu CUSTOM.</p>",
          variables: ["prospect.name", "prospect.entreprise"],
        },
      },
    );
    expect(createRes.status()).toBe(201);
    const { template } = (await createRes.json()) as {
      template: { id: string; slug: string; label: string };
    };
    expect(template.slug).toBe("ma-relance-custom");

    // LIST
    const listRes = await page.request.get(
      `${PROSPECTION_URL}/api/admin/mail-templates`,
    );
    expect(listRes.ok()).toBe(true);
    const { templates } = (await listRes.json()) as {
      templates: Array<{ id: string; slug: string; label: string }>;
    };
    expect(templates.some((t) => t.id === template.id)).toBe(true);

    // UPDATE label
    const updateRes = await page.request.put(
      `${PROSPECTION_URL}/api/admin/mail-templates/${template.id}`,
      { data: { label: "Ma relance — v2" } },
    );
    expect(updateRes.ok()).toBe(true);
    const { template: updated } = (await updateRes.json()) as {
      template: { label: string };
    };
    expect(updated.label).toBe("Ma relance — v2");

    // SOFT-DELETE
    const delRes = await page.request.delete(
      `${PROSPECTION_URL}/api/admin/mail-templates/${template.id}`,
    );
    expect(delRes.ok()).toBe(true);

    // Vérif : ne s'affiche plus dans /api/admin/mail-templates.
    const listAfter = await page.request.get(
      `${PROSPECTION_URL}/api/admin/mail-templates`,
    );
    const { templates: afterDel } = (await listAfter.json()) as {
      templates: Array<{ id: string }>;
    };
    expect(afterDel.some((t) => t.id === template.id)).toBe(false);
  });

  test("conflict 409 si slug déjà utilisé (non soft-deleted)", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);

    await page.request.post(`${PROSPECTION_URL}/api/admin/mail-templates`, {
      data: {
        slug: "duplicate-slug",
        label: "First",
        subject: "S",
        bodyText: "T",
        bodyHtml: "<p>T</p>",
      },
    });

    const conflictRes = await page.request.post(
      `${PROSPECTION_URL}/api/admin/mail-templates`,
      {
        data: {
          slug: "duplicate-slug",
          label: "Second",
          subject: "S",
          bodyText: "T",
          bodyHtml: "<p>T</p>",
        },
      },
    );
    expect(conflictRes.status()).toBe(409);
  });

  test("send avec slug custom → corps custom utilisé (pas le fallback hardcodé)", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL, MAILPIT_SMTP);

    // Shadow le slug "relance-commerciale-v1" avec un custom différent.
    await page.request.post(`${PROSPECTION_URL}/api/admin/mail-templates`, {
      data: {
        slug: "relance-commerciale-v1",
        label: "Ma relance shadowée",
        subject: "Custom subject for {{ prospect.entreprise }}",
        bodyText:
          "Custom body — Bonjour {{ prospect.name }}. Signature ici.",
        bodyHtml:
          "<p>Custom body — Bonjour {{ prospect.name }}. Signature ici.</p>",
      },
    });

    const sendRes = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: "custom-tpl@mailpit.local",
        siren: "100000006",
        templateSlug: "relance-commerciale-v1",
        vars: { prospect: { name: "Alice", entreprise: "Acme SAS" } },
      },
    });
    expect(sendRes.status()).toBe(200);

    const lastMail = await lastLeadEmail();
    expect(lastMail?.subject).toContain("Custom subject for Acme SAS");
    expect(lastMail?.bodyText).toContain("Custom body — Bonjour Alice");
  });
});

test.describe("I — Aperçu mail avant envoi", () => {
  test("preview rend variables remplies + détecte non-substituées", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL, MAILPIT_SMTP);

    const res = await page.request.post(
      `${PROSPECTION_URL}/api/mail/render-preview`,
      {
        data: {
          subject: "Pour {{ prospect.entreprise }}",
          bodyText:
            "Bonjour {{ prospect.name }}, je n'ai pas {{ prospect.missing }}.",
          bodyHtml:
            "<p>Bonjour {{ prospect.name }}, manque {{ prospect.missing }}.</p>",
          vars: { prospect: { name: "Alice", entreprise: "Acme SAS" } },
        },
      },
    );
    expect(res.ok()).toBe(true);
    const data = (await res.json()) as {
      subject: string;
      bodyText: string;
      bodyHtml: string;
      unresolvedVars: string[];
    };
    expect(data.subject).toBe("Pour Acme SAS");
    expect(data.bodyText).toContain("Bonjour Alice");
    // Variable manquante → laissée brute + signalée.
    expect(data.bodyText).toContain("{{prospect.missing}}");
    expect(data.unresolvedVars).toContain("prospect.missing");
  });

  test("preview avec includeSignature true → signature appliquée au rendu", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL, MAILPIT_SMTP);

    // Set la signature.
    await page.request.put(`${PROSPECTION_URL}/api/mail/signature`, {
      data: {
        mailSignatureHtml: "<p><strong>Robert Brunon</strong><br>Veridian</p>",
        mailSignatureEnabled: true,
      },
    });

    const res = await page.request.post(
      `${PROSPECTION_URL}/api/mail/render-preview`,
      {
        data: {
          subject: "S",
          bodyText: "Bonjour {{ prospect.name }}",
          bodyHtml: "<p>Bonjour {{ prospect.name }}</p>",
          vars: { prospect: { name: "Alice", entreprise: "Acme" } },
          includeSignature: true,
        },
      },
    );
    const data = (await res.json()) as { bodyHtml: string; bodyText: string };
    expect(data.bodyHtml).toContain('class="veridian-mail-signature"');
    expect(data.bodyHtml).toContain("<strong>Robert Brunon</strong>");
    expect(data.bodyText).toContain("--\nRobert Brunon");
  });
});

test.describe("J — Signature commerciale auto", () => {
  test.beforeEach(async () => {
    await purgeLeadEmails();
    await clearMailSignature();
  });

  test("PUT /api/mail/signature → tenant_mail_config maj", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL, MAILPIT_SMTP);

    const putRes = await page.request.put(
      `${PROSPECTION_URL}/api/mail/signature`,
      {
        data: {
          mailSignatureHtml: "<p>Robert Brunon — Veridian</p>",
          mailSignatureEnabled: true,
        },
      },
    );
    expect(putRes.ok()).toBe(true);

    const getRes = await page.request.get(
      `${PROSPECTION_URL}/api/mail/signature`,
    );
    const data = (await getRes.json()) as {
      mailSignatureHtml: string;
      mailSignatureEnabled: boolean;
    };
    expect(data.mailSignatureHtml).toContain("Robert Brunon");
    expect(data.mailSignatureEnabled).toBe(true);
  });

  test("send synchrone + signature enabled → mail envoyé avec signature", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL, MAILPIT_SMTP);

    await page.request.put(`${PROSPECTION_URL}/api/mail/signature`, {
      data: {
        mailSignatureHtml: "<p>Robert Brunon — Veridian Prospection</p>",
        mailSignatureEnabled: true,
      },
    });

    const sendRes = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: "sig-enabled@mailpit.local",
        siren: "100000007",
        subject: "Sig test",
        bodyText: "Body",
        bodyHtml: "<p>Body</p>",
      },
    });
    expect(sendRes.status()).toBe(200);

    const lastMail = await lastLeadEmail();
    expect(lastMail?.sentStatus).toBe("sent");
    expect(lastMail?.bodyHtml).toContain("veridian-mail-signature");
    expect(lastMail?.bodyHtml).toContain(
      "Robert Brunon — Veridian Prospection",
    );
    expect(lastMail?.bodyText).toContain("--\nRobert Brunon");
  });

  test("signature disabled → pas de signature appendée", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL, MAILPIT_SMTP);

    await page.request.put(`${PROSPECTION_URL}/api/mail/signature`, {
      data: {
        mailSignatureHtml: "<p>Robert Brunon — Veridian</p>",
        mailSignatureEnabled: false,
      },
    });

    const sendRes = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: "sig-disabled@mailpit.local",
        siren: "100000008",
        subject: "No sig",
        bodyText: "Plain body",
        bodyHtml: "<p>Plain body</p>",
      },
    });
    expect(sendRes.status()).toBe(200);

    const lastMail = await lastLeadEmail();
    expect(lastMail?.bodyHtml).not.toContain("veridian-mail-signature");
    expect(lastMail?.bodyHtml).not.toContain("Robert Brunon");
  });
});

test.describe("RBAC + sécurité", () => {
  test("non-auth POST /api/admin/mail-templates → 401", async ({ request }) => {
    const res = await request.post(
      `${PROSPECTION_URL}/api/admin/mail-templates`,
      {
        data: {
          slug: "x",
          label: "X",
          subject: "S",
          bodyText: "T",
          bodyHtml: "<p>T</p>",
        },
      },
    );
    // 401 (non auth) ou 403 (auth user non admin) — les deux refus sont OK.
    expect([401, 403]).toContain(res.status());
  });

  test("non-auth POST /api/mail/render-preview → 401", async ({ request }) => {
    const res = await request.post(
      `${PROSPECTION_URL}/api/mail/render-preview`,
      {
        data: {
          subject: "S",
          bodyText: "T",
          vars: { prospect: { name: "X", entreprise: "Y" } },
        },
      },
    );
    expect([401, 403]).toContain(res.status());
  });
});
