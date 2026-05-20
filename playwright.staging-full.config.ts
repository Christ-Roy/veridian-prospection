/**
 * Config Playwright pour E2E headfull contre staging — exigée §20.6
 * CI-ARCHITECTURE (promotion tier 🔴 HAUT).
 *
 * Diffère de playwright.config.ts (CI standard) :
 *   - baseURL forcée sur staging (pas localhost)
 *   - headfull (HEADED=1 obligatoire) : vrai navigateur visible
 *   - 1 seul worker (séquentiel) : on simule un user humain
 *   - slowMo 50ms : oeil humain peut suivre, screenshots cohérents
 *   - retries 0 : flaky = bug à investiguer, pas masquer
 *   - timeout 60s : navigateur réel + login Auth.js + redirects
 *
 * Run : pnpm e2e:staging:full
 */
import { defineConfig, devices } from "@playwright/test";

const STAGING_URL =
  process.env.STAGING_URL || "https://prospection.staging.veridian.site";

export default defineConfig({
  testDir: "./e2e/staging-full",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "e2e-headfull-staging.json" }]],
  use: {
    baseURL: STAGING_URL,
    headless: false,
    launchOptions: {
      slowMo: 50,
    },
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-headfull",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
