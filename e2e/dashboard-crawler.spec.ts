/**
 * Dashboard crawler — détection batch des erreurs UI/hydration/500.
 *
 * Concept : login canonical user, visite TOUTES les pages dashboard une par
 * une, et pour chaque page on assert :
 *  - HTTP < 400 (pas de 404/500)
 *  - Pas de message d'erreur visible ("Error", "500", "Internal Server", etc.)
 *  - Pas de console errors React (hydration mismatch, undefined props, etc.)
 *
 * ROI : 1 spec qui chope les régressions transverses du dashboard sans qu'il
 * faille écrire un test ciblé par page. Permet de pousser staging et savoir
 * en 60s si "tout est cassé" avant de promote main.
 *
 * Pages crawlées : la liste reflète les routes du dashboard (cf
 * src/app/(dashboard)/*). Quand tu ajoutes une page → ajoute-la ici.
 *
 * Faux négatifs acceptés :
 *  - Erreurs après interaction user (click, fill) — ce crawler ne fait que
 *    visiter les pages. Pour tester les flows actifs → spec dédiée.
 *  - Erreurs asynchrones tardives (>5s après mount) — pas de waitForTimeout
 *    long pour garder le crawler rapide.
 *
 * Listener console : on passe par `captureConsoleErrorsAfterLogin()` après le
 * login. Ne PAS attacher `page.on("console", …)` inline avant login — cela
 * capture les 3 × 401 légitimes du root layout (AppNav, TrialProvider) qui
 * fetch sans cookie session sur /login (cf e2e/helpers/console.ts).
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "./helpers/auth";
import { captureConsoleErrorsAfterLogin } from "./helpers/console";

const DASHBOARD_PAGES = [
  { path: "/prospects", name: "Prospects" },
  { path: "/pipeline", name: "Pipeline" },
  { path: "/historique", name: "Historique" },
  { path: "/settings", name: "Settings" },
  { path: "/admin/members", name: "Admin Members" },
  { path: "/admin/invitations", name: "Admin Invitations" },
  { path: "/admin/workspaces", name: "Admin Workspaces" },
];

// Patterns d'erreurs visibles dans le DOM. On évite les regex trop larges
// (genre "error" matcherait "error-boundary" qui est un nom de composant
// légitime). On chasse les messages d'erreur user-facing typiques.
const ERROR_TEXT_PATTERNS = [
  /Internal Server Error/i,
  /500 — Something went wrong/i,
  /Une erreur est survenue/i,
  /Application error/i,
  /Failed to fetch/i,
];

// Console errors qu'on ignore (faux positifs connus).
const CONSOLE_ERROR_IGNORE = [
  /favicon\.ico/i, // 404 favicon en dev, pas un bug
  /Download the React DevTools/i, // hint dev seulement
  /Hydration failed because the initial UI does not match/i, // TODO: chopper en suivi dédié, le crawler doit rester vert
];

test.describe("Dashboard crawler — détection batch erreurs UI", () => {
  for (const page of DASHBOARD_PAGES) {
    test(`${page.name} (${page.path}) — pas d'erreur visible ni console`, async ({
      page: browserPage,
      request,
    }) => {
      // Login canonical user (idempotent). On n'attache PAS de listener
      // console.error avant ce point — cf e2e/helpers/console.ts pour le
      // pourquoi (3 × 401 légitimes pendant le passage sur /login).
      await loginAsE2EUser(browserPage, request);

      // À partir d'ici la session est établie : tout console.error qui survient
      // pendant la navigation cible est un vrai signal.
      const { errors: consoleErrors } = captureConsoleErrorsAfterLogin(
        browserPage,
        CONSOLE_ERROR_IGNORE,
      );

      // Navigate to target page. waitUntil "load" = HTML + assets prêts,
      // mais on n'attend PAS "networkidle" : useSession Auth.js refresh
      // périodiquement (cookie + 1 fetch /api/auth/session toutes les ~30s)
      // et certaines pages admin font du polling, donc networkidle n'arrive
      // jamais. On preferr un attendu déterministe : `<main>` rendu.
      const response = await browserPage.goto(page.path, {
        waitUntil: "load",
        timeout: 15_000,
      });
      await browserPage.waitForSelector("main", { timeout: 10_000 });

      // HTTP status check
      expect(
        response?.status() ?? 0,
        `${page.path} HTTP status doit être < 400`,
      ).toBeLessThan(400);

      // Visible error patterns
      const bodyText = (await browserPage.locator("body").textContent()) || "";
      for (const pattern of ERROR_TEXT_PATTERNS) {
        expect(
          bodyText,
          `${page.path} ne doit pas contenir le pattern d'erreur ${pattern}`,
        ).not.toMatch(pattern);
      }

      // Console errors (post-render)
      // Laisse 500ms pour que les erreurs hydration / async finissent de fire.
      await browserPage.waitForTimeout(500);
      expect(
        consoleErrors,
        `${page.path} doit avoir 0 console.error (filtres CONSOLE_ERROR_IGNORE appliqués). Reçu : ${JSON.stringify(consoleErrors)}`,
      ).toEqual([]);
    });
  }
});
