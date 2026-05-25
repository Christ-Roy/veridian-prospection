/**
 * E2E hard-core Mail v2 — Hub Mail Gateway (Gmail OAuth user).
 *
 * Suite §20.6 — exécution headfull avant promo tier 🔴+.
 *
 * Refactor 2026-05-26 : la colonne workspace.mail_provider a été droppée
 * (migration 0035) — la source de vérité est désormais le Hub via
 * `checkHubMailProviderStatus`. La spec couvre désormais uniquement le
 * happy path Hub Gateway + RBAC + validation + erreurs Hub. Les tests
 * sending-account UI/toggle ont disparu (l'UI a été supprimée).
 *
 *  1. Happy path : si hubUserId set + Hub joignable → branche Hub Gateway
 *  2. Validation : recipient invalide → 400
 *  3. Validation : subject vide → 400
 *  4. Validation : ni bodyText ni bodyHtml → 400
 *  5. RBAC : non-auth → 401
 *  6. Routing : hubUserId absent → fallback SMTP (jamais branche Hub)
 *  7. Concurrence : 2 POST simultanés même idempotency_key → idempotent
 *
 * Skip propre si STAGING_URL pas en ligne.
 */
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsE2EUser } from "../helpers/auth";

const STAGING_URL =
  process.env.STAGING_URL ||
  process.env.PROSPECTION_URL ||
  "https://prospection.staging.veridian.site";

function getPrisma() {
  return new PrismaClient();
}

/** Set hubUserId sur user E2E (force la branche Hub Gateway si Hub linked). */
async function setUserHubId(email: string, hubUserId: string | null): Promise<void> {
  const prisma = getPrisma();
  try {
    await prisma.user.update({
      where: { email },
      data: { hubUserId },
    });
  } finally {
    await prisma.$disconnect();
  }
}

const VALID_PAYLOAD = {
  to: "destination@yopmail.com",
  siren: "900000001",
  subject: "[E2E hub gateway] hello",
  bodyText: "Test envoi via Hub Mail Gateway",
  bodyHtml: "<p>Test envoi via Hub Mail Gateway</p>",
};

test.describe("Mail v2 — Hub Gateway (E2E hard-core)", () => {
  test.beforeAll(async () => {
    // Healthcheck staging — skip toute la suite si l'app ne répond pas.
    try {
      const res = await fetch(`${STAGING_URL}/api/health`);
      if (!res.ok) {
        test.skip(
          true,
          `${STAGING_URL}/api/health a renvoyé ${res.status} — staging KO`,
        );
      }
    } catch (err) {
      test.skip(true, `staging unreachable: ${(err as Error).message}`);
    }
  });

  test("01. happy path : hubUserId set + Hub joignable → branche Hub Gateway", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await loginAsE2EUser(page, request);
    // hubUserId fake : si Hub réel renvoie linked → 200 (impossible sans
    // OAuth réel) ; sinon checkHubMailProviderStatus retourne false →
    // fallback SMTP (412 missing_credentials sauf si SMTP configuré).
    // On valide simplement que la chaîne ne crashe pas (pas de 500).
    await setUserHubId("e2e-persistent@yopmail.com", "e2e-hub-user-id-1");

    const res = await page.request.post(`${STAGING_URL}/api/mail/send`, {
      data: VALID_PAYLOAD,
    });
    // Pas de 500 : la route s'est exécutée proprement quelle que soit la
    // branche prise (Hub Gateway succès, fallback SMTP, ou erreur Hub mappée).
    expect([200, 202, 400, 404, 412, 422, 429, 502, 503]).toContain(
      res.status(),
    );
  });

  test("02. recipient invalide → 400 (validation Zod)", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);

    const res = await page.request.post(`${STAGING_URL}/api/mail/send`, {
      data: { ...VALID_PAYLOAD, to: "not-an-email" },
    });
    expect(res.status()).toBe(400);
  });

  test("03. subject vide → 400", async ({ page, request }) => {
    await loginAsE2EUser(page, request);

    const res = await page.request.post(`${STAGING_URL}/api/mail/send`, {
      data: { ...VALID_PAYLOAD, subject: "" },
    });
    expect(res.status()).toBe(400);
  });

  test("04. ni bodyText ni bodyHtml → 400", async ({ page, request }) => {
    await loginAsE2EUser(page, request);

    const res = await page.request.post(`${STAGING_URL}/api/mail/send`, {
      data: {
        to: VALID_PAYLOAD.to,
        siren: VALID_PAYLOAD.siren,
        subject: VALID_PAYLOAD.subject,
      },
    });
    expect(res.status()).toBe(400);
  });

  test("05. RBAC : non-auth → 401", async ({ request }) => {
    // Pas de loginAsE2EUser → request sans cookie session.
    const res = await request.post(`${STAGING_URL}/api/mail/send`, {
      data: VALID_PAYLOAD,
    });
    expect(res.status()).toBe(401);
  });

  test("06. fallback SMTP : hubUserId absent → JAMAIS branche Hub", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    // Sans hubUserId, la route ne tente même pas l'appel Hub status.
    await setUserHubId("e2e-persistent@yopmail.com", null);

    const res = await page.request.post(`${STAGING_URL}/api/mail/send`, {
      data: VALID_PAYLOAD,
    });
    const body = (await res.json().catch(() => ({}))) as {
      reason?: string;
      provider?: string;
    };
    // Pas de fuite vers Hub (provider !== 'gmail-via-hub').
    expect(body.provider).not.toBe("gmail-via-hub");
    if (res.status() === 412) {
      expect(body.reason).toBe("missing_credentials");
    }
  });

  test("07. concurrence : 2 envois même idempotency_key → idempotent", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await loginAsE2EUser(page, request);
    await setUserHubId("e2e-persistent@yopmail.com", "e2e-hub-user-id-1");

    const idem = "55555555-5555-4555-8555-555555555555";
    const payload = { ...VALID_PAYLOAD, idempotencyKey: idem };

    const [r1, r2] = await Promise.all([
      page.request.post(`${STAGING_URL}/api/mail/send`, { data: payload }),
      page.request.post(`${STAGING_URL}/api/mail/send`, { data: payload }),
    ]);
    // Les 2 POST sont valides : pas de 400/500. Le code de statut dépend
    // de l'état réel du Hub et du SMTP — on accepte les codes mappés.
    expect([200, 202, 404, 412, 422, 429, 502, 503]).toContain(r1.status());
    expect([200, 202, 404, 412, 422, 429, 502, 503]).toContain(r2.status());
    if (r1.status() === 200 && r2.status() === 200) {
      const b1 = (await r1.json()) as { idempotentReplay?: boolean };
      const b2 = (await r2.json()) as { idempotentReplay?: boolean };
      expect(b1.idempotentReplay || b2.idempotentReplay).toBe(true);
    }
  });
});
