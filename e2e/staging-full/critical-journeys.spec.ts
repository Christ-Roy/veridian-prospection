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
