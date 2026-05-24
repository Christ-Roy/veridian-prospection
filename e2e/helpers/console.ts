/**
 * Helper E2E — capture des erreurs console **après** un login.
 *
 * POURQUOI CE HELPER EXISTE
 * -------------------------
 * Si tu attaches `page.on("console", …)` AVANT `loginAsE2EUser`, tu captures
 * les 3 × 401 légitimes de `AppNav` + `TrialProvider` qui se montent dès
 * `/login` (root layout `src/app/layout.tsx`). Ces fetches au mount n'ont pas
 * encore de cookie session → erreurs console → faux positifs.
 *
 * Incident d'origine : `todo/done/2026-05-23-fix-401-api-routes-clientside-auth.md`
 * + ticket dette `todo/done/2026-05-23-e2e-console-listener-pattern-helper.md`
 * (commit `67d7e38`).
 *
 * RÈGLE
 * -----
 * N'utilise PAS `page.on("console", …)` inline dans un spec qui assert sur
 * l'absence d'erreurs console post-login. Passe par `captureConsoleErrorsAfterLogin()`
 * APRÈS `await loginAsE2EUser(page, request)`.
 *
 * USAGE
 * -----
 *   import { loginAsE2EUser } from "./helpers/auth";
 *   import { captureConsoleErrorsAfterLogin } from "./helpers/console";
 *
 *   test("...", async ({ page, request }) => {
 *     await loginAsE2EUser(page, request);
 *     const { errors } = captureConsoleErrorsAfterLogin(page, [
 *       /favicon\.ico/i,           // 404 favicon dev — pas un bug
 *       /React DevTools/i,         // hint dev
 *     ]);
 *
 *     await page.goto("/prospects");
 *     // ...
 *     await page.waitForTimeout(500); // laisse fire les erreurs tardives
 *     expect(errors).toEqual([]);
 *   });
 */
import type { ConsoleMessage, Page } from "@playwright/test";

export interface ConsoleErrorCapture {
  /** Tableau muté en place : push à chaque console.error non ignorée. */
  errors: string[];
}

/**
 * Attache un listener `console.error` à la page. Les erreurs console
 * survenues AVANT l'appel sont ignorées par design (c'est tout l'intérêt
 * du helper — voir docstring du module).
 *
 * @param page          La Page Playwright (déjà authentifiée).
 * @param ignorePatterns Liste de RegExp d'erreurs à ignorer (faux positifs
 *                       connus : favicon 404, DevTools hint, etc.).
 * @returns Un objet `{ errors }` dont le tableau `errors` est muté à mesure
 *          que des console.error tombent. Lis-le après ta navigation.
 */
export function captureConsoleErrorsAfterLogin(
  page: Page,
  ignorePatterns: RegExp[] = [],
): ConsoleErrorCapture {
  const capture: ConsoleErrorCapture = { errors: [] };

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (ignorePatterns.some((p) => p.test(text))) return;
    capture.errors.push(text);
  });

  return capture;
}
