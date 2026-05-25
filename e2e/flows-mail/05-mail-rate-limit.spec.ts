/**
 * Flow mail #5 — Rate limit /api/mail/send.
 *
 * Contrat réel (src/app/api/mail/send/route.ts) : 30 envois / 5min sliding
 * window par user. Le 31e retourne 429.
 *
 * Le ticket d'origine mentionnait 10/min — c'était une supposition.
 * Cette spec asserte le COMPORTEMENT REEL du code, pas la spec demandée.
 * Si on veut durcir à 10/min, c'est un follow-up (issue posée en docs/
 * ou todo/).
 *
 * Pourquoi ce test est important :
 *   - protège contre un bug UI qui spammerait (boucle de retry).
 *   - protège contre une dérive du seuil (régression silencieuse).
 *
 * Coût : 31 envois SMTP vers mailpit (~10s), 31 rows lead_emails — purgées
 * en beforeEach.
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";
import {
  seedMailConfig,
  purgeLeadEmails,
  countLeadEmails,
} from "./_helpers/mail-config";
import { assertMailpitUp, purgeMailbox } from "./_helpers/mailpit";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

// Sliding window de 5 min côté code — pour que ce test soit robuste, on
// déclenche au-delà du seuil (30) dans une fenêtre courte ; le bucket
// global peut déjà contenir des sends d'autres specs si l'ordre change,
// donc on tape large : on envoie jusqu'à voir le 429.
const RATE_LIMIT_MAX = 30;
const PROBE_COUNT = 35;

test.describe("Mail flow — Rate limit /api/mail/send", () => {
  test.beforeEach(async () => {
    await assertMailpitUp();
    await purgeMailbox();
    await purgeLeadEmails();
  });

  // Le rate limit bucket persiste 5 min en mémoire process. Si une spec
  // précédente a déjà envoyé N mails, on est partiellement engagé. Pour
  // limiter le couplage, ce test est positionné en 05 (dernier) et tolère
  // que le 429 arrive avant la 30e tentative.
  test("≥30 sends en rafale → 429 retourné", async ({ page, request }) => {
    test.setTimeout(120_000); // 35 envois × 1-2s = ~40s, on prend large.

    await loginAsE2EUser(page, request);
    await seedMailConfig(page, PROSPECTION_URL);

    let firstRateLimitedAt: number | null = null;
    let successCount = 0;

    for (let i = 0; i < PROBE_COUNT; i++) {
      const res = await page.request.post(
        `${PROSPECTION_URL}/api/mail/send`,
        {
          data: {
            to: `rate-${i}@yopmail.com`,
            siren: "900000001",
            subject: `Rate test ${i}`,
            bodyText: `Body ${i}`,
            bodyHtml: `<p>Body ${i}</p>`,
          },
        },
      );
      if (res.status() === 429) {
        firstRateLimitedAt = i;
        const body = (await res.json()) as { error?: string };
        expect(body.error).toBe("Rate limited");
        break;
      }
      if (res.status() === 200) {
        successCount++;
      }
    }

    expect(
      firstRateLimitedAt,
      `Aucun 429 reçu en ${PROBE_COUNT} envois — le rate limiter ne ` +
        `protège pas /api/mail/send (limit attendu ≤${RATE_LIMIT_MAX}).`,
    ).not.toBeNull();
    expect(firstRateLimitedAt!).toBeLessThanOrEqual(RATE_LIMIT_MAX);

    // Vérifie que les sends OK ont effectivement été tracés en DB.
    const dbSent = await countLeadEmails({ sentStatus: "sent" });
    expect(dbSent).toBe(successCount);
  });
});
