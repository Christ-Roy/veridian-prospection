/**
 * Atlas est la page d'accueil : « / » répond et montre Atlas, « /atlas » y renvoie, et sans
 * session on part vers /login. Compte de test existant uniquement (jamais de signup en e2e).
 */
import { test, expect } from "@playwright/test";

const PROSPECTION_URL = process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";
const EMAIL = process.env.ROBERT_EMAIL || "robert.brunon@veridian.site";
const MOT_DE_PASSE = process.env.ROBERT_PASSWORD || "";

test.describe("Atlas, page d'accueil", () => {
  test("sans session, « / » renvoie vers /login", async ({ page }) => {
    const res = await page.goto(`${PROSPECTION_URL}/`);
    expect(res?.status() ?? 0).toBeLessThan(500);
    await expect(page).toHaveURL(/\/login/);
  });

  test("connecté, « / » montre Atlas et « /atlas » y renvoie", async ({ page }) => {
    test.skip(!MOT_DE_PASSE, "ROBERT_PASSWORD absent : connexion locale impossible");
    const erreurs: string[] = [];
    page.on("pageerror", (e) => erreurs.push(e.message));

    await page.goto(`${PROSPECTION_URL}/login`);
    await page.locator("#email").fill(EMAIL);
    await page.locator("#password").fill(MOT_DE_PASSE);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });

    const res = await page.goto(`${PROSPECTION_URL}/`);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/Atlas/);
    await expect(page.getByRole("navigation", { name: "Marchés et cibles" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Atlas", { exact: true }).first()).toBeAttached();
    // L'ancienne barre de navigation n'est plus montée.
    await expect(page.getByRole("link", { name: /^Prospects$/ })).toHaveCount(0);

    await page.goto(`${PROSPECTION_URL}/atlas`);
    await expect(page).toHaveURL(new RegExp(`^${PROSPECTION_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`));
    expect(erreurs).toEqual([]);
  });
});
