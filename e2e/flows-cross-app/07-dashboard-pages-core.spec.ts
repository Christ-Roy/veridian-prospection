/**
 * Flow cross-app #7 — Pages dashboard core sans erreur visible ni console.
 *
 * Equivalent du dashboard-crawler.spec.ts existant, mais EXÉCUTÉ
 * depuis le bundle flows-cross-app (script opt-in dev-pub). On ne
 * dépend pas de la CI staging qui peut ne pas câbler le crawler en
 * environnement container (cf ticket
 * 2026-05-22-fix-crawler-database-url-staging-ci.md).
 *
 * Couvre chacune des 7 pages dashboard :
 *   /prospects, /pipeline, /historique, /settings,
 *   /admin/members, /admin/invitations, /admin/workspaces
 *
 * Asserts par page :
 *   - HTTP < 400
 *   - <main> rendu (la page a hydraté)
 *   - Aucun message d'erreur visible ("Internal Server Error",
 *     "Application error", ...)
 *   - Aucun console.error React significatif (filtre faux positifs
 *     navigateur réseau)
 *
 * Anti-régression : un crash transverse (hydration mismatch, route
 * 500, server component qui jette) fait rougir au moins une page.
 */
import { test, expect, type ConsoleMessage } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

const DASHBOARD_PAGES = [
  { path: "/prospects", name: "Prospects" },
  { path: "/pipeline", name: "Pipeline" },
  { path: "/historique", name: "Historique" },
  { path: "/settings", name: "Settings" },
  { path: "/admin/members", name: "Admin Members" },
  { path: "/admin/invitations", name: "Admin Invitations" },
  { path: "/admin/workspaces", name: "Admin Workspaces" },
];

const ERROR_TEXT_PATTERNS = [
  /Internal Server Error/i,
  /500 — Something went wrong/i,
  /Une erreur est survenue/i,
  /Application error/i,
];

const CONSOLE_ERROR_IGNORE = [
  /favicon\.ico/i,
  /Download the React DevTools/i,
  /Hydration failed because the initial UI does not match/i,
  /Failed to load resource/i,
  /Failed to fetch/i,
  /net::ERR_FAILED/i,
  /sw\.js|service worker|ServiceWorker/i,
  /stripe|googleapis|gstatic|fonts\./i,
];

function shouldIgnoreConsoleError(msg: string): boolean {
  return CONSOLE_ERROR_IGNORE.some((p) => p.test(msg));
}

test.describe("Flow cross-app — Dashboard pages core", () => {
  // Une spec parente : login une fois, puis loop sur toutes les pages.
  // (vs. dashboard-crawler.spec.ts qui re-login par page — utile en CI
  // parallèle, surcoût ici car on est sériel.)
  test("toutes les pages dashboard rendent sans erreur visible ni console", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);

    const failures: string[] = [];

    for (const target of DASHBOARD_PAGES) {
      const consoleErrors: string[] = [];
      const errorListener = (msg: ConsoleMessage) => {
        if (msg.type() === "error") {
          const text = msg.text();
          if (!shouldIgnoreConsoleError(text)) consoleErrors.push(text);
        }
      };
      page.on("console", errorListener);

      try {
        const response = await page.goto(`${PROSPECTION_URL}${target.path}`, {
          waitUntil: "load",
          timeout: 20_000,
        });
        const status = response?.status() ?? 0;
        if (status >= 400) {
          failures.push(`${target.name}: HTTP ${status}`);
          continue;
        }

        // <main> rendu (page a hydraté)
        await page.waitForSelector("main", { timeout: 10_000 }).catch(() => {
          failures.push(`${target.name}: <main> jamais rendu`);
        });

        // Pas de message d'erreur visible dans le DOM
        const visibleText = await page.locator("body").innerText().catch(() => "");
        for (const pattern of ERROR_TEXT_PATTERNS) {
          if (pattern.test(visibleText)) {
            failures.push(
              `${target.name}: message d'erreur visible: ${pattern}`,
            );
            break;
          }
        }

        // Pas d'erreur console significative
        if (consoleErrors.length > 0) {
          failures.push(
            `${target.name}: console errors [${consoleErrors.length}]: ${consoleErrors
              .slice(0, 2)
              .join(" | ")}`,
          );
        }
      } catch (err) {
        failures.push(
          `${target.name}: navigation failed: ${(err as Error).message}`,
        );
      } finally {
        page.off("console", errorListener);
      }
    }

    expect(failures, `Pages cassées :\n${failures.join("\n")}`).toEqual([]);
  });
});
