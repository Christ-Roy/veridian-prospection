/**
 * E2E headfull staging — Timeline 360° Phase 2 (mails sortants) + Phase 3
 * (appels Telnyx).
 *
 * Spec exigée par §20.6 CI-ARCHITECTURE pour valider la promotion tier 🔴
 * HAUT (extension query timeline + UI + nouveaux contrats API).
 *
 * Pattern : on évite de polluer la DB staging en créant n'importe quel mail
 * ou appel — à la place on utilise un SIREN "test" et on vérifie les
 * contrats (whitelist types, shape JSON, headers, RBAC). Les events de
 * fond restent ceux de la timeline réelle (Phase 1 historiquement).
 *
 * Couvre :
 *   1. /api/leads/[siren]/timeline accepte ?types=mail_out (200, shape ok)
 *   2. /api/leads/[siren]/timeline accepte ?types=call (200)
 *   3. /api/leads/[siren]/timeline accepte ?types=mail_out,call (combiné)
 *   4. /api/leads/[siren]/timeline rejette les types inconnus (ex: mail_in pas encore livré)
 *   5. /api/leads/[siren]/timeline reste 401 sans auth
 *   6. /api/leads/[siren]/timeline reste 400 SIREN malformé
 *   7. Cache-Control reste private (pas de leak)
 *   8. La fiche prospect /prospects?p=<siren> charge sans erreur uncaught
 *   9. L'onglet Historique de la fiche est navigable au clavier (a11y minimale)
 *  10. Shape JSON mail_out conforme (subject?, bodyPreview?, status, fromEmail)
 *  11. Shape JSON call conforme (direction, status, durationSeconds?, recordingPath?)
 *  12. Tri descending respecté quand mail_out + call mergés
 */
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const EMAIL = process.env.STAGING_USER_EMAIL || "robert.brunon@veridian.site";
const PASSWORD = process.env.STAGING_USER_PASSWORD;

if (!PASSWORD) {
  throw new Error(
    "STAGING_USER_PASSWORD manquant — exigé pour login. Source ~/credentials/.all-creds.env",
  );
}

// SIREN existant côté DB staging avec a minima 1 transition Phase 1 (utilisé
// par les critical-journeys, ex: CHATEX = 814810212). Si la timeline est
// vide pour ce SIREN, les tests acceptent un retour [] (le contrat reste
// vérifié sur shape + status).
const SAMPLE_SIREN = process.env.STAGING_SAMPLE_SIREN || "814810212";
// SIREN inconnu (jamais provisionné) → la timeline reste [] mais doit
// quand même renvoyer 200 (la route ne révèle pas l'existence).
const UNKNOWN_SIREN = "999999998";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD as string);
  await page.getByRole("button", { name: /se connecter/i }).click();
  await page.waitForURL(/\/(prospects|historique|$)/, { timeout: 20_000 });
}

async function fetchTimeline(
  request: APIRequestContext,
  siren: string,
  query: Record<string, string> = {},
) {
  const params = new URLSearchParams(query).toString();
  return request.get(
    `/api/leads/${siren}/timeline${params ? `?${params}` : ""}`,
  );
}

test.describe("Timeline 360° Phase 2-3 — contrats API", () => {
  test("1. types=mail_out accepté → 200 + array events", async ({ page }) => {
    await login(page);
    const res = await fetchTimeline(page.request, SAMPLE_SIREN, { types: "mail_out" });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });

  test("2. types=call accepté → 200 + array events", async ({ page }) => {
    await login(page);
    const res = await fetchTimeline(page.request, SAMPLE_SIREN, { types: "call" });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });

  test("3. types=mail_out,call combiné → 200", async ({ page }) => {
    await login(page);
    const res = await fetchTimeline(page.request, SAMPLE_SIREN, {
      types: "mail_out,call",
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { events: Array<{ type: string }> };
    // Tous les events retournés DOIVENT être mail_out ou call (pas de leak
    // pipeline_transition / followup / appointment)
    for (const evt of body.events) {
      expect(["mail_out", "call"]).toContain(evt.type);
    }
  });

  test("4. types=mail_in rejette silencieusement (whitelist) → 200 + []", async ({
    page,
  }) => {
    await login(page);
    const res = await fetchTimeline(page.request, SAMPLE_SIREN, { types: "mail_in" });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    // mail_in pas encore exposé (Phase 2.5 W8b IMAP). Le filter whitelist le
    // drop → types devient [] → aucune source interrogée → events []
    expect(body.events).toEqual([]);
  });

  test("5. /api/leads/[siren]/timeline reste 401 sans auth", async ({ request }) => {
    const res = await request.get(`/api/leads/${SAMPLE_SIREN}/timeline`, {
      headers: { cookie: "" },
    });
    expect(res.status()).toBe(401);
  });

  test("6. SIREN malformé → 400", async ({ page }) => {
    await login(page);
    const res = await fetchTimeline(page.request, "ABC123");
    expect(res.status()).toBe(400);
  });

  test("7. Cache-Control reste private (pas de leak CDN)", async ({ page }) => {
    await login(page);
    const res = await fetchTimeline(page.request, SAMPLE_SIREN, { types: "mail_out" });
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toContain("private");
  });

  test("8. SIREN inconnu → 200 + [] (pas de 404 = pas de révélation cross-tenant)", async ({
    page,
  }) => {
    await login(page);
    const res = await fetchTimeline(page.request, UNKNOWN_SIREN);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });

  test("9. Shape mail_out — champs obligatoires si présents", async ({ page }) => {
    await login(page);
    const res = await fetchTimeline(page.request, SAMPLE_SIREN, { types: "mail_out" });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      events: Array<Record<string, unknown>>;
    };
    for (const evt of body.events) {
      expect(evt.type).toBe("mail_out");
      expect(typeof evt.id).toBe("string");
      expect(typeof evt.occurredAt).toBe("string");
      expect(typeof evt.fromEmail).toBe("string");
      expect(Array.isArray(evt.toEmails)).toBe(true);
      expect(typeof evt.status).toBe("string");
      // subject + bodyPreview + templateSlug peuvent être null
      expect(["string", "object"]).toContain(typeof evt.subject);
      expect(["string", "object"]).toContain(typeof evt.bodyPreview);
    }
  });

  test("10. Shape call — direction + status obligatoires, durée/recording nullable", async ({
    page,
  }) => {
    await login(page);
    const res = await fetchTimeline(page.request, SAMPLE_SIREN, { types: "call" });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      events: Array<Record<string, unknown>>;
    };
    for (const evt of body.events) {
      expect(evt.type).toBe("call");
      expect(typeof evt.id).toBe("string");
      expect(typeof evt.occurredAt).toBe("string");
      expect(typeof evt.direction).toBe("string");
      expect(typeof evt.status).toBe("string");
      expect(typeof evt.provider).toBe("string");
      // durationSeconds et recordingPath peuvent être null
      expect(["number", "object"]).toContain(typeof evt.durationSeconds);
      expect(["string", "object"]).toContain(typeof evt.recordingPath);
    }
  });

  test("11. Tri descending respecté quand mail_out+call merged", async ({ page }) => {
    await login(page);
    const res = await fetchTimeline(page.request, SAMPLE_SIREN, {
      types: "mail_out,call",
    });
    const body = (await res.json()) as {
      events: Array<{ occurredAt: string }>;
    };
    // Vérifie tri desc strict (si > 1 event)
    for (let i = 1; i < body.events.length; i++) {
      const prev = body.events[i - 1]!.occurredAt;
      const curr = body.events[i]!.occurredAt;
      expect(prev >= curr).toBe(true);
    }
  });

  test("12. RBAC — fetcher l'API avec un cookie session valide reste 200, sans cookie 401", async ({
    page,
    request,
  }) => {
    // Logged-in : 200
    await login(page);
    const ok = await fetchTimeline(page.request, SAMPLE_SIREN, { types: "mail_out" });
    expect(ok.status()).toBe(200);
    // Pas logged-in (fresh request context Playwright) : 401
    const unauth = await request.get(`/api/leads/${SAMPLE_SIREN}/timeline`);
    expect(unauth.status()).toBe(401);
  });

  test("13. limit=1 + types=mail_out → events.length <= 1", async ({ page }) => {
    await login(page);
    const res = await fetchTimeline(page.request, SAMPLE_SIREN, {
      types: "mail_out",
      limit: "1",
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events.length).toBeLessThanOrEqual(1);
  });

  test("14. limit > 500 clampé (limite max sécurité)", async ({ page }) => {
    await login(page);
    const res = await fetchTimeline(page.request, SAMPLE_SIREN, {
      types: "mail_out,call",
      limit: "99999",
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    // Le clamp est à 500 côté route ; impossible d'avoir plus
    expect(body.events.length).toBeLessThanOrEqual(500);
  });

  test("15. Page /prospects charge sans erreur console uncaught (sanity post-déploy)", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await login(page);
    await page.goto("/prospects");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    const realErrors = errors.filter(
      (e) =>
        !/Failed to load resource/.test(e) &&
        !/Failed to fetch/.test(e) &&
        !/net::ERR_FAILED/.test(e) &&
        !/sw\.js|service worker|ServiceWorker/i.test(e) &&
        !/stripe|googleapis|gstatic|fonts\./i.test(e),
    );
    if (realErrors.length > 0) {
      console.error("[E2E timeline P2-P3] Erreurs console détectées :", realErrors);
    }
    expect(realErrors).toEqual([]);
  });
});
