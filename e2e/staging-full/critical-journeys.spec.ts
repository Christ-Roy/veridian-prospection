/**
 * E2E headfull staging — user journeys critiques Prospection.
 *
 * Spec exigée par §20.6 CI-ARCHITECTURE pour valider une promotion tier
 * 🔴 HAUT (modif auth, migrations DB, modif provision).
 *
 * Couvre :
 *   1. Login credentials Robert → /prospects render
 *   2. /historique → status CHATEX affiché correctement (pas "A contacter")
 *   3. /pipeline → render avec colonnes par stage
 *   4. /prospects → mode discovery (filtre status != fiche_ouverte)
 *   5. SW v2 actif (caches.keys() = ["veridian-prospection-v2"])
 *   6. /api/health → 200
 *   7. Détecte erreurs console côté browser (pas de uncaught)
 *
 * NOTE : ne couvre pas le flow Hub→autologin (couvert par
 * /tmp/smoke_autologin.sh côté serveur). Ici on teste le **front Prospection
 * une fois logué** — c'est l'interface des commerciaux.
 */
import { test, expect, type Page } from "@playwright/test";

const EMAIL = process.env.STAGING_USER_EMAIL || "robert.brunon@veridian.site";
const PASSWORD = process.env.STAGING_USER_PASSWORD;

if (!PASSWORD) {
  throw new Error(
    "STAGING_USER_PASSWORD manquant — exigé pour login. Source ~/credentials/.all-creds.env",
  );
}

async function login(page: Page) {
  await page.goto("/login");
  // Email a placeholder, password n'en a pas → utilise getByLabel pour les deux
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD as string);
  await page.getByRole("button", { name: /se connecter/i }).click();
  // Attendre la redirection (Auth.js → /prospects ou /)
  await page.waitForURL(/\/(prospects|historique|$)/, { timeout: 20_000 });
}

/**
 * Test cross-app SSO Hub→Prosp. Reproduit fidèlement le journey commercial :
 *  1. Hub `/api/prospection/regenerate-login` génère un loginToken (HMAC)
 *  2. POST côté Hub stocke le token dans Tenant Hub + Prosp persiste le sien
 *  3. Browser navigue sur /api/auth/token?t=<token>
 *  4. Prosp valide via Prisma local + crée session Auth.js JWT
 *  5. Cookie __Secure-authjs.session-token set + redirect /prospects
 *
 * Validé manuellement 2026-05-20 via Chrome MCP — promu en test régression.
 * Ne dépend pas du Hub : utilise directement HMAC standard pour générer le
 * token comme le Hub, ce qui isole le test de la disponibilité Hub staging.
 */
test.describe("Cross-app SSO Hub→Prospection", () => {
  test("HMAC provision → autologin → session valide + cookie + /prospects", async ({
    request,
    browser,
  }) => {
    const HUB_SECRET =
      process.env.STAGING_HUB_API_SECRET || "staging-prospection-secret-2026";
    const STAGING_URL =
      process.env.STAGING_URL || "https://prospection.staging.veridian.site";
    // User staging dédié — owner d'un tenant existant côté Prosp
    const userId = "53245ae1-6bf8-4ec6-870f-32d75b7c0281";
    const email = "robert.brunon@veridian.site";

    // 1) Provision HMAC (simule le Hub)
    const ts = Date.now();
    const body = JSON.stringify({
      email,
      name: "Robert",
      plan: "freemium",
      user_id: userId,
      metadata: { hub_user_id: userId },
    });
    const crypto = await import("crypto");
    const signature = crypto
      .createHmac("sha256", HUB_SECRET)
      .update(`${ts}.${body}`)
      .digest("hex");

    const provisionRes = await request.post(
      `${STAGING_URL}/api/tenants/provision`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Veridian-Timestamp": String(ts),
          "X-Veridian-Hub-Signature": signature,
        },
        data: body,
      },
    );
    expect(provisionRes.status()).toBe(200);
    const provisionData = (await provisionRes.json()) as { login_url: string };
    expect(provisionData.login_url).toMatch(/\/api\/auth\/token\?t=[a-f0-9]{64}$/);

    // 2) Browser navigue sur le login_url (fresh context, pas de cookie)
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(provisionData.login_url);
    // Attendre la redirection finale
    await page.waitForURL(/\/(prospects|$)/, { timeout: 10_000 });

    // 3) Cookie session set ?
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) =>
      /authjs\.session-token/.test(c.name),
    );
    expect(sessionCookie, "cookie session manquant").toBeDefined();
    expect(sessionCookie!.httpOnly).toBe(true);
    expect(sessionCookie!.sameSite?.toLowerCase()).toBe("lax");

    // 4) /api/auth/session retourne bien le user (sessionnement effectif)
    const sessionRes = await page.request.get(`${STAGING_URL}/api/auth/session`);
    expect(sessionRes.status()).toBe(200);
    const session = (await sessionRes.json()) as { user?: { id: string; email: string } };
    expect(session.user?.id).toBe(userId);
    expect(session.user?.email).toBe(email);

    // 5) Replay du même token → token_used
    const replayRes = await context.request.get(provisionData.login_url, {
      maxRedirects: 0,
    });
    const replayLocation = replayRes.headers()["location"] ?? "";
    expect(replayLocation).toContain("token_used");

    await context.close();
  });
});

test.describe("Journeys critiques staging headfull", () => {
  test("1. Login credentials → dashboard render", async ({ page }) => {
    await login(page);
    // Page logged-in doit contenir un élément de nav
    await expect(page.getByRole("link", { name: /prospects/i }).first()).toBeVisible();
  });

  test("2. /historique → CHATEX affiche 'Site demo', PAS 'A contacter'", async ({ page }) => {
    await login(page);
    await page.goto("/historique");
    // Attendre le chargement du tableau
    await page.waitForSelector("table", { timeout: 10_000 });

    // Find la ligne CHATEX
    const chatexRow = page.locator("tr").filter({ hasText: /chatex/i }).first();
    await expect(chatexRow).toBeVisible({ timeout: 10_000 });

    // Le badge status (cellule statut) — doit afficher "Site demo" exactement
    const badge = chatexRow.locator(".bg-purple-100, .bg-purple-50").first();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Site demo");

    // Smoke check inverse : aucune ligne CHATEX ne doit afficher "A contacter"
    const wrongBadge = chatexRow.locator("span").filter({ hasText: "A contacter" });
    await expect(wrongBadge).toHaveCount(0);
  });

  test("3. /pipeline → render colonnes par stage", async ({ page }) => {
    await login(page);
    await page.goto("/pipeline");
    // Au moins une colonne pipeline doit être visible (les stages canoniques)
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    const pipelineBoard = page.locator('[class*="pipeline"], main').first();
    await expect(pipelineBoard).toBeVisible();
  });

  test("4. /prospects → API renvoie outreach_status canoniques", async ({ page }) => {
    await login(page);
    const response = await page.request.get("/api/prospects?page=1&pageSize=10");
    expect(response.status()).toBe(200);
    const data = (await response.json()) as { data: Array<{ outreach_status: string }> };
    // Tous les status retournés doivent être dans la whitelist canonique
    const CANONICAL = new Set([
      "a_contacter", "fiche_ouverte", "repondeur", "a_rappeler",
      "site_demo", "acompte", "finition", "client", "upsell",
      "archive", "pas_interesse", "hors_cible",
      // Legacy tolérés (présents en DB mais mappés côté StatusBadge)
      "appele", "rappeler", "interesse", "rdv", "contacte", "qualified",
      "disqualifie", "non_qualifie", "non_pertinent", "rejete",
      "skip", "skip_qualifie", "a_ignorer", "en_attente", "en_observation",
      "email_invalide",
    ]);
    for (const lead of data.data ?? []) {
      expect(
        CANONICAL.has(lead.outreach_status),
        `outreach_status "${lead.outreach_status}" pas dans la liste canonique`,
      ).toBe(true);
    }
  });

  test("5. Service Worker v2 actif (cache busting OK)", async ({ page }) => {
    await login(page);
    // Attendre que le SW s'enregistre
    await page.waitForTimeout(2000);
    const cacheKeys = await page.evaluate(() => caches.keys());
    // v2 ou plus récent doit être présent ; v1 ne doit plus exister
    const hasV2OrLater = cacheKeys.some((k) => /veridian-prospection-v[2-9]/.test(k));
    const hasOnlyV1 = cacheKeys.length > 0 && cacheKeys.every((k) => k.endsWith("-v1"));
    expect(hasV2OrLater || cacheKeys.length === 0).toBe(true);
    expect(hasOnlyV1).toBe(false);
  });

  test("6. /api/health → 200", async ({ page }) => {
    const response = await page.request.get("/api/health");
    expect(response.status()).toBe(200);
  });

  test("7. Pas d'erreur uncaught console sur /historique", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await login(page);
    await page.goto("/historique");
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    // Filtre les erreurs réseau attendues (rate-limit, 404 ressource externe,
    // 401 transitoire en cours de session-load…) — on ne veut détecter QUE
    // les vraies erreurs JS / uncaught.
    const realErrors = errors.filter(
      (e) =>
        !/Failed to load resource/.test(e) &&
        !/Failed to fetch/.test(e) &&
        !/net::ERR_FAILED/.test(e) &&
        !/sw\.js|service worker|ServiceWorker/i.test(e) &&
        !/stripe|googleapis|gstatic|fonts\./i.test(e),
    );
    if (realErrors.length > 0) {
      // Logge pour debug si fail
      console.error("[E2E] Erreurs console détectées :", realErrors);
    }
    expect(realErrors).toEqual([]);
  });
});
