/**
 * Config Playwright pour les flows cross-app (e2e/flows-cross-app/).
 *
 * Cible : staging réel via container Playwright sur dev-pub (réseau
 * staging-edge → DNS interne `prospection-staging-prospection-1` ou
 * `prospection.staging.veridian.site` via Traefik). NE TOURNE PAS en CI
 * bloquante (trop long et nécessite secrets HMAC + DATABASE_URL).
 * Lancé via scripts/e2e/flows-cross-app.sh.
 *
 * Diffère de :
 *   - playwright.config.ts (CI standard) : multi-browser, fullyParallel,
 *     webServer local. Pas adapté aux flows cross-app qui exigent un
 *     vrai backend + DB.
 *   - playwright.staging-full.config.ts (E2E headfull §20.6) : headed,
 *     1 worker, slowMo 50ms, pour validation manuelle promo tier 🔴.
 *     Trop lent et headed bloque dans un container sans display.
 *
 * Choix :
 *   - headless (container Docker, pas de display X)
 *   - 1 worker : les flows partagent l'état DB (canonical user, replay
 *     de tokens). Sérialiser élimine les flakes.
 *   - retries 1 : un seul retry pour le coup de réseau ponctuel, mais
 *     pas plus (un vrai bug ne doit pas être masqué).
 *   - timeout 90s : la séquence "provision + autologin + check Prisma"
 *     dépasse facilement 30s sur staging.
 */
import { defineConfig, devices } from "@playwright/test";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

export default defineConfig({
  testDir: "./e2e/flows-cross-app",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["list"], ["json", { outputFile: "e2e-flows-cross-app.json" }]],
  use: {
    baseURL: PROSPECTION_URL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Le client Auth.js cookie domain bascule entre __Secure- (HTTPS)
    // et plain (HTTP) — laisser Playwright suivre les redirects/cookies
    // par défaut, pas de config particulière.
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
