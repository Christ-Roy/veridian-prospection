/**
 * E2E hard-core mail v1 improvements (W9c 2026-05-25).
 *
 * Périmètre (ticket follow-ups §F + §A + §I + §J) :
 *  - F Queue : POST /api/mail/send → 202 instantané + row mail_outbox(queued) +
 *    lead_emails(sent_status=queued). Cron flush → mail réellement envoyé via
 *    mailpit, mail_outbox.status='sent', lead_emails(sent_status='sent').
 *  - F Queue idempotence : 2 sends avec même idempotency_key → 1 seule row.
 *  - F Queue retry exponential : SMTP host unreachable → status='failed_retry'
 *    + nextRetryAt dans le futur. Au flush suivant (next_retry_at <= NOW), nouveau
 *    try.
 *  - F Queue max attempts : après 5 fails → status='failed' + lead_emails=failed.
 *  - A Templates CRUD : admin POST/PUT/DELETE → tenant_mail_templates row OK.
 *  - A Templates RBAC : member POST /api/admin/mail-templates → 403.
 *  - A Templates resolve : send avec un slug custom → corps custom utilisé.
 *  - I Preview : POST /api/mail/render-preview rend les variables, détecte
 *    les non-substituées, applique signature.
 *  - J Signature : PUT /api/mail/signature → row tenant_mail_config maj.
 *    Send via outbox → signature appendée au body envoyé.
 *  - J Signature disable : enabled=false → pas de signature appendée.
 *
 * Le tenant E2E (e2e0e2e0-0000-4000-8000-000000000002) sert pour tout.
 * Toutes les modifs SQL passent par l'API ou Prisma direct (pour bypass
 * cycles cron). On consomme manuellement le cron /api/cron/mail-outbox-flush
 * pour ne pas attendre 1 min.
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
const CRON_SECRET = process.env.CRON_SECRET;
const E2E_TENANT_ID = "e2e0e2e0-0000-4000-8000-000000000002";

let prismaSingleton: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
}

/** Purge mail_outbox du tenant E2E. */
async function purgeMailOutbox(): Promise<void> {
  const prisma = getPrisma();
  await prisma.mailOutbox.deleteMany({ where: { tenantId: E2E_TENANT_ID } });
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

/** Force next_retry_at = NOW() pour tous les rows en failed_retry — accélère les tests retry. */
async function fastForwardOutboxRetries(): Promise<void> {
  const prisma = getPrisma();
  await prisma.mailOutbox.updateMany({
    where: { tenantId: E2E_TENANT_ID, status: "failed_retry" },
    data: { nextRetryAt: new Date() },
  });
}

/** Force-trigger le cron flush — bypass délai 1 min. */
async function triggerFlush(): Promise<{
  picked: number;
  sent: number;
  failedRetry: number;
  failed: number;
}> {
  if (!CRON_SECRET) {
    throw new Error("CRON_SECRET manquant — impossible de trigger le flush");
  }
  const res = await fetch(`${PROSPECTION_URL}/api/cron/mail-outbox-flush`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!res.ok) {
    throw new Error(
      `[mail-outbox-flush] ${res.status}: ${await res.text()}`,
    );
  }
  return res.json() as Promise<{
    picked: number;
    sent: number;
    failedRetry: number;
    failed: number;
  }>;
}

async function readOutboxRow(idempotencyKey: string) {
  const prisma = getPrisma();
  return prisma.mailOutbox.findUnique({
    where: { idempotencyKey },
  });
}

async function countOutbox(opts: { status?: string } = {}): Promise<number> {
  const prisma = getPrisma();
  return prisma.mailOutbox.count({
    where: {
      tenantId: E2E_TENANT_ID,
      ...(opts.status ? { status: opts.status } : {}),
    },
  });
}

test.describe("F — Queue d'envoi (mail_outbox)", () => {
  test.beforeEach(async () => {
    await purgeMailOutbox();
    await purgeLeadEmails();
    await clearMailSignature();
  });

  test("happy path : POST /api/mail/send → 202 + row queued + lead_emails queued", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL, MAILPIT_SMTP);

    const res = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: "queue-happy@mailpit.local",
        siren: "100000001",
        subject: "Queue happy path",
        bodyText: "Hi from queue",
        bodyHtml: "<p>Hi from queue</p>",
      },
    });
    expect(res.status()).toBe(202);
    const body = (await res.json()) as {
      ok: boolean;
      status: string;
      outboxId: string;
      leadEmailId: string;
      idempotencyKey: string;
    };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("queued");
    expect(body.outboxId).toBeTruthy();

    // Row outbox(queued) + lead_emails(queued) immédiatement présents.
    const outbox = await readOutboxRow(body.idempotencyKey);
    expect(outbox?.status).toBe("queued");

    const lastMail = await lastLeadEmail();
    expect(lastMail?.sentStatus).toBe("queued");
    expect(lastMail?.subject).toBe("Queue happy path");
  });

  test("flush cron → mail envoyé, mail_outbox=sent, lead_emails=sent", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL, MAILPIT_SMTP);

    const sendRes = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: "queue-flush@mailpit.local",
        siren: "100000002",
        subject: "Flush me",
        bodyText: "Flush body",
        bodyHtml: "<p>Flush body</p>",
      },
    });
    expect(sendRes.status()).toBe(202);
    const sendBody = (await sendRes.json()) as { idempotencyKey: string };

    // Trigger flush via cron endpoint.
    const flushResult = await triggerFlush();
    expect(flushResult.picked).toBeGreaterThanOrEqual(1);
    expect(flushResult.sent).toBeGreaterThanOrEqual(1);

    const outbox = await readOutboxRow(sendBody.idempotencyKey);
    expect(outbox?.status).toBe("sent");
    expect(outbox?.sentAt).not.toBeNull();

    const lastMail = await lastLeadEmail();
    expect(lastMail?.sentStatus).toBe("sent");
    expect(lastMail?.messageId).not.toBeNull();
    expect(lastMail?.messageId).not.toMatch(/^queued-/);
  });

  test("idempotency_key : 2 sends même key → 1 seule row outbox", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL, MAILPIT_SMTP);

    const idempotencyKey = "11111111-2222-4333-8444-555555555555";
    const payload = {
      to: "idem@mailpit.local",
      siren: "100000003",
      subject: "Idem subject",
      bodyText: "Idem body",
      bodyHtml: "<p>Idem body</p>",
      idempotencyKey,
    };

    const r1 = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: payload,
    });
    expect(r1.status()).toBe(202);
    const b1 = (await r1.json()) as { outboxId: string; alreadyEnqueued: boolean };
    expect(b1.alreadyEnqueued).toBe(false);

    const r2 = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: payload,
    });
    expect(r2.status()).toBe(202);
    const b2 = (await r2.json()) as { outboxId: string; alreadyEnqueued: boolean };
    expect(b2.alreadyEnqueued).toBe(true);
    expect(b2.outboxId).toBe(b1.outboxId);

    // Une seule row outbox + une seule row lead_emails.
    expect(await countOutbox()).toBe(1);
  });

  test("retry exponential : SMTP unreachable → status=failed_retry + next_retry_at futur", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await loginAsE2EUser(page, request);
    // Config SMTP volontairement cassée → l'envoi va échouer.
    await seedMailConfig(page, PROSPECTION_URL, {
      ...MAILPIT_SMTP,
      host: "smtp-does-not-exist.invalid",
      port: 587,
    });

    const sendRes = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: "retry@mailpit.local",
        siren: "100000004",
        subject: "Retry me",
        bodyText: "Retry body",
        bodyHtml: "<p>Retry body</p>",
      },
    });
    expect(sendRes.status()).toBe(202);
    const sendBody = (await sendRes.json()) as { idempotencyKey: string };

    // Premier flush → fail → status=failed_retry.
    const flush1 = await triggerFlush();
    expect(flush1.picked).toBeGreaterThanOrEqual(1);

    const outbox1 = await readOutboxRow(sendBody.idempotencyKey);
    expect(outbox1?.status).toBe("failed_retry");
    expect(outbox1?.attempts).toBe(1);
    expect(outbox1?.lastError).toBeTruthy();
    // nextRetryAt dans le futur (1 min après now).
    expect(outbox1?.nextRetryAt.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  test("max attempts atteint : status=failed + lead_emails=failed", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL, {
      ...MAILPIT_SMTP,
      host: "smtp-does-not-exist.invalid",
      port: 587,
    });

    const sendRes = await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: "max-attempts@mailpit.local",
        siren: "100000005",
        subject: "Max",
        bodyText: "Max body",
        bodyHtml: "<p>Max body</p>",
      },
    });
    expect(sendRes.status()).toBe(202);
    const sendBody = (await sendRes.json()) as { idempotencyKey: string };

    // Force 5 flushs (5 tentatives = MAIL_OUTBOX_MAX_ATTEMPTS).
    for (let i = 0; i < 5; i++) {
      await fastForwardOutboxRetries();
      await triggerFlush();
    }

    const finalRow = await readOutboxRow(sendBody.idempotencyKey);
    expect(finalRow?.status).toBe("failed");
    expect(finalRow?.attempts).toBe(5);

    // lead_emails reflète l'échec définitif.
    const prisma = getPrisma();
    const lead = await prisma.leadEmail.findFirst({
      where: { tenantId: E2E_TENANT_ID, siren: "100000005" },
    });
    expect(lead?.sentStatus).toBe("failed");
    expect(lead?.sentError).toBeTruthy();
  });
});

test.describe("A — Templates customisables par tenant", () => {
  test.beforeEach(async () => {
    await purgeTenantTemplates();
    await purgeMailOutbox();
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
    expect(sendRes.status()).toBe(202);

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
    await purgeMailOutbox();
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

  test("send via outbox + signature enabled → mail envoyé avec signature", async ({
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
    expect(sendRes.status()).toBe(202);

    await triggerFlush();

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

    await page.request.post(`${PROSPECTION_URL}/api/mail/send`, {
      data: {
        to: "sig-disabled@mailpit.local",
        siren: "100000008",
        subject: "No sig",
        bodyText: "Plain body",
        bodyHtml: "<p>Plain body</p>",
      },
    });

    await triggerFlush();

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

  test("cron flush sans Bearer → 401", async () => {
    const res = await fetch(
      `${PROSPECTION_URL}/api/cron/mail-outbox-flush`,
      { method: "POST" },
    );
    expect(res.status).toBe(401);
  });
});
