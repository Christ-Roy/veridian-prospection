/**
 * Invited member flow e2e — verify that an invited workspace member
 * can log in, see prospects (no obfuscation), and use the pipeline.
 *
 * 2026-05-23 — migré vers le compte invité canonique seedé par
 * `helpers/auth.ts §6` (E2E_INVITED_EMAIL/PASSWORD). L'ancien compte
 * `r.brunon@agence-veridian.fr` (password Robert hardcodé) dépendait
 * d'un seed manuel et générait des skip silencieux quand son password
 * dérivait. Le compte canonique est seedé idempotent (User + Account
 * credentials + WorkspaceMember role=member, scope=own) avant chaque
 * run via `ensureCanonicalUser()` — couvre exactement le scenario
 * "membre invité non-admin" de la spec.
 */
import { test, expect } from "@playwright/test";
import {
  E2E_INVITED_EMAIL,
  E2E_INVITED_PASSWORD,
  ensureCanonicalUser,
} from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.app.veridian.site";

test.describe("Invited member flow", () => {
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    // Seed idempotent du compte invité (et du reste de la chaîne canonique).
    // Sans cet appel, la spec rougirait au login — c'est exactement le
    // comportement voulu : plus de SKIP silencieux quand le compte n'existe pas.
    await ensureCanonicalUser();
  });

  async function loginInvited(page: import("@playwright/test").Page) {
    await page.goto(`${PROSPECTION_URL}/login`);
    await page.getByLabel("Email", { exact: true }).fill(E2E_INVITED_EMAIL);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(E2E_INVITED_PASSWORD);
    await page.getByRole("button", { name: /se connecter/i }).click();
    await page.waitForURL(/\/(prospects|$)/, { timeout: 20000 }).catch(() => {});

    // Vérifie la session Auth.js v5 réellement établie — plus de "if
    // /login then return silencieux", on rougit si le login a foiré.
    const session = await page.evaluate(async () => {
      const res = await fetch("/api/auth/session");
      return res.ok ? await res.json() : null;
    });
    expect(
      session?.user?.id,
      `login invité KO — session absente après /login (url=${page.url()}). ` +
        `Vérifie que ensureCanonicalUser a bien seedé le User + Account ` +
        `credentials pour ${E2E_INVITED_EMAIL}.`,
    ).toBeTruthy();
  }

  test("member can login and see prospects without obfuscation", async ({ page }) => {
    await loginInvited(page);

    // Wait for table to load
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // Check that data is NOT obfuscated (no "•" characters in visible text)
    const bodyText = (await page.locator("table tbody").textContent()) ?? "";
    const hasObfuscation = bodyText.includes("•");
    expect(
      hasObfuscation,
      "Data should NOT be obfuscated for workspace members",
    ).toBeFalsy();

    // Check that "Admin" link is NOT visible (member is not admin)
    const adminLink = page.locator("a", { hasText: /admin/i });
    const adminVisible = await adminLink
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    expect(
      adminVisible,
      "lien Admin ne doit pas être visible pour un membre non-admin (scope own)",
    ).toBeFalsy();
  });

  test("member can access /pipeline", async ({ page }) => {
    await loginInvited(page);

    await page.goto(`${PROSPECTION_URL}/pipeline`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // Pipeline should load without 500 / "Erreur" visible.
    const hasError = await page
      .locator("text=/500|erreur serveur|Internal Error/i")
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    expect(
      hasError,
      "Pipeline should not show error for invited member",
    ).toBeFalsy();

    // Et on doit être resté sur /pipeline (pas redirect vers /login).
    expect(
      page.url(),
      "Membre invité doit accéder /pipeline sans redirect login",
    ).toContain("/pipeline");
  });
});
