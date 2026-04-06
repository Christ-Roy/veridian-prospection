/**
 * Admin pages V1 smoke — vérifie que les 5 pages admin chargent sans console error.
 *
 * Pages couvertes:
 *  - /admin              (dashboard V1)
 *  - /admin/workspaces
 *  - /admin/members
 *  - /admin/kpi
 *  - /admin/invitations
 *
 * Stratégie:
 *  - Login via loginAsE2EUser (persistant, partagé par tous les specs)
 *  - Goto → networkidle → petite attente pour laisser React hydrater
 *  - Assert qu'un <h1> ou <h2> visible existe
 *  - Assert que le body ne contient pas "404" ou "This page could not be found"
 *  - Zero console error
 *  - Screenshot sur failure
 *
 * Note: le user e2e-persistent n'est pas forcément admin. Si la page redirige
 * (403 → /prospects), on skip gracieusement ce cas plutôt que de hard-fail —
 * le vrai test admin se fait via robert dans admin-pages-smoke.spec.ts.
 */
import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { loginAsE2EUser } from '../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";

const ADMIN_PAGES = [
  { path: "/admin", label: "dashboard V1" },
  { path: "/admin/workspaces", label: "workspaces" },
  { path: "/admin/members", label: "members" },
  { path: "/admin/kpi", label: "kpi" },
  { path: "/admin/invitations", label: "invitations" },
] as const;

function attachErrorListeners(page: Page, sink: string[]) {
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (t.includes("GTM") || t.includes("dataLayer") || t.includes("favicon")) return;
    if (t.includes("Failed to load resource")) return;
    if (t.includes("chrome-extension://")) return;
    if (t.includes("401") || t.includes("403")) return;
    sink.push(t);
  });
  page.on("pageerror", (err) => {
    sink.push(`PAGE_ERROR: ${err.message}`);
  });
}

test.describe("Admin pages V1 smoke", () => {
  test.setTimeout(90_000);

  for (const { path, label } of ADMIN_PAGES) {
    test(`${path} loads without console errors (${label})`, async ({
      page,
      request,
    }, testInfo) => {
      const errors: string[] = [];
      attachErrorListeners(page, errors);

      await loginAsE2EUser(page, request);

      await page.goto(`${PROSPECTION_URL}${path}`);
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // Si la page redirige (user non-admin → /prospects), on skip gracieusement.
      const finalUrl = page.url();
      if (!finalUrl.includes(path)) {
        console.log(
          `ℹ ${path} redirected to ${finalUrl} (probably non-admin user) — skipping assertions`,
        );
        testInfo.skip(
          true,
          `${path} redirected to ${finalUrl} — e2e user not admin on this tenant`,
        );
        return;
      }

      // Pas de page 404
      const bodyText = (await page.textContent("body")) || "";
      expect(
        bodyText.includes("This page could not be found"),
        `${path}: page shows 404 marker`,
      ).toBe(false);
      // "404" peut apparaître dans d'autres contextes (status codes d'une liste),
      // donc on cible surtout le texte de page 404 Next.js. On check "404" comme
      // additional safety mais seulement combiné avec "not found".
      expect(
        /404\s*(\||—|:)\s*this page/i.test(bodyText) || /404\s*not found/i.test(bodyText),
        `${path}: body contains Next.js 404 page`,
      ).toBe(false);

      // Au moins un <h1> ou <h2> visible
      const headings = page.locator("h1, h2");
      const count = await headings.count();
      expect(count, `${path}: no <h1>/<h2> found`).toBeGreaterThan(0);
      // au moins un visible
      let visible = false;
      for (let i = 0; i < count; i++) {
        if (await headings.nth(i).isVisible().catch(() => false)) {
          visible = true;
          break;
        }
      }
      expect(visible, `${path}: no visible <h1>/<h2>`).toBe(true);

      if (errors.length > 0) {
        await page.screenshot({
          path: `e2e/screenshots/admin-v1-${path.replace(/\//g, "_")}.png`,
          fullPage: true,
        });
      }
      expect(errors, `${path} console errors: ${errors.join("\n")}`).toHaveLength(0);
    });
  }
});
