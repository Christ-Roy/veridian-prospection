/**
 * Phone endpoints smoke — couvre les API /api/phone/* en auth user.
 *
 * Ne teste PAS le vrai WebRTC ni l'aller-retour Telnyx (qui nécessite
 * un compte avec crédit et un device qui décroche). On vérifie :
 *  - 401 sans auth (gating)
 *  - 200 + structure correcte avec session valide (autologin cross-app)
 *  - 500 propre si Telnyx pas configuré côté staging (les creds
 *    `TELNYX_API_KEY` peuvent être absents → on ne fail PAS le test)
 *
 * Endpoints couverts :
 *  - POST /api/phone/telnyx-token (WebRTC SDK token)
 *  - GET  /api/phone/presence     (online/offline status)
 *  - POST /api/phone/presence     (toggle status)
 *  - POST /api/phone/call-log     (initiation event)
 *
 * Auth : on utilise le helper cross-app (provision tenant + autologin via
 * /api/auth/token) plutôt que loginAsE2EUser, parce que ce spec cible
 * spécifiquement le flow autologin Hub→Prospection (génération de token
 * via /api/tenants/provision et consommation via /api/auth/token).
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { provisionAndLogin } from "../helpers/cross-app-login";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

async function loggedInCookieHeader(
  context: BrowserContext,
): Promise<string> {
  const cookies = await context.cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

test.describe("Phone endpoints — auth + smoke", () => {
  test.setTimeout(60_000);

  test.describe("non authentifié → 401", () => {
    test("POST /api/phone/telnyx-token → 401", async ({ request }) => {
      const res = await request.post(`${PROSPECTION_URL}/api/phone/telnyx-token`, {
        data: {},
      });
      expect(res.status()).toBe(401);
    });

    test("GET /api/phone/presence → 401", async ({ request }) => {
      const res = await request.get(`${PROSPECTION_URL}/api/phone/presence`);
      expect(res.status()).toBe(401);
    });

    test("POST /api/phone/presence → 401", async ({ request }) => {
      const res = await request.post(`${PROSPECTION_URL}/api/phone/presence`, {
        data: { online: true },
      });
      expect(res.status()).toBe(401);
    });

    test("POST /api/phone/call-log → 401", async ({ request }) => {
      const res = await request.post(`${PROSPECTION_URL}/api/phone/call-log`, {
        data: { status: "initiated", direction: "outgoing", to_number: "+33123456789" },
      });
      expect(res.status()).toBe(401);
    });
  });

  test.describe("authentifié (autologin cross-app)", () => {
    test("POST /api/phone/telnyx-token → 200 token | 500 not_configured", async ({
      browser,
      request,
    }) => {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      try {
        await provisionAndLogin(request, context);
        const cookie = await loggedInCookieHeader(context);
        const res = await request.post(`${PROSPECTION_URL}/api/phone/telnyx-token`, {
          headers: { cookie, "Content-Type": "application/json" },
          data: {},
        });
        // Staging peut ne pas avoir TELNYX_API_KEY → 500 acceptable.
        // En revanche, jamais 401 (auth passe), jamais 404 (route existe).
        expect([200, 500]).toContain(res.status());
        if (res.status() === 200) {
          const body = (await res.json()) as { token?: string };
          expect(body.token, "Telnyx token should be a non-empty string").toBeTruthy();
          expect(typeof body.token).toBe("string");
          expect(body.token!.length).toBeGreaterThan(20);
        } else {
          const body = (await res.json()) as { error?: string };
          expect(body.error, "500 should have an error message").toBeTruthy();
        }
      } finally {
        await context.close();
      }
    });

    test("GET → POST → GET /api/phone/presence : toggle online", async ({
      browser,
      request,
    }) => {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      try {
        await provisionAndLogin(request, context);
        const cookie = await loggedInCookieHeader(context);

        const before = await request.get(`${PROSPECTION_URL}/api/phone/presence`, {
          headers: { cookie },
        });
        expect(before.ok()).toBeTruthy();
        const beforeBody = (await before.json()) as { online?: boolean; lastSeen?: string | null };
        expect(typeof beforeBody.online).toBe("boolean");

        // Toggle.
        const target = !beforeBody.online;
        const toggle = await request.post(`${PROSPECTION_URL}/api/phone/presence`, {
          headers: { cookie, "Content-Type": "application/json" },
          data: { online: target },
        });
        expect(toggle.ok()).toBeTruthy();
        const toggleBody = (await toggle.json()) as { ok?: boolean; online?: boolean };
        expect(toggleBody.ok).toBe(true);
        expect(toggleBody.online).toBe(target);

        // Lecture confirme la persistance.
        const after = await request.get(`${PROSPECTION_URL}/api/phone/presence`, {
          headers: { cookie },
        });
        const afterBody = (await after.json()) as { online?: boolean; lastSeen?: string | null };
        expect(afterBody.online).toBe(target);
        expect(afterBody.lastSeen).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      } finally {
        await context.close();
      }
    });

    test("POST /api/phone/call-log initiation → 200 + callId", async ({
      browser,
      request,
    }) => {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      try {
        await provisionAndLogin(request, context);
        const cookie = await loggedInCookieHeader(context);

        // Mode 1 du handler — initiation, INSERT call_log sans side-effect outreach.
        const fakeSiren = "999999999"; // 9 digits, ne matche aucune fiche réelle.
        const initRes = await request.post(`${PROSPECTION_URL}/api/phone/call-log`, {
          headers: { cookie, "Content-Type": "application/json" },
          data: {
            direction: "outgoing",
            provider: "telnyx",
            from_number: "+33974066175",
            to_number: "+33100000000",
            siren: fakeSiren,
            status: "initiated",
            started_at: new Date().toISOString(),
          },
        });
        expect(
          initRes.ok(),
          `call-log initiation failed: ${initRes.status()} ${await initRes.text()}`,
        ).toBeTruthy();
        const initBody = (await initRes.json()) as { ok?: boolean; callId?: number };
        expect(initBody.ok).toBe(true);
        expect(typeof initBody.callId).toBe("number");
        expect(initBody.callId).toBeGreaterThan(0);
      } finally {
        await context.close();
      }
    });
  });
});
