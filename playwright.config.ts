import { defineConfig, devices } from "@playwright/test";

/**
 * Multi-browser projects : chromium, firefox, webkit.
 * CI peut override via --project=chromium pour matrixer en parallel.
 * La variable BROWSER permet aussi de restreindre en local.
 */
const allProjects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
];

const onlyBrowser = process.env.BROWSER;
const projects = onlyBrowser
  ? allProjects.filter((p) => p.name === onlyBrowser)
  : allProjects;

/**
 * Parallelism:
 *  - fullyParallel: every spec runs in its own worker. Core specs are
 *    designed to be idempotent on their own user (Robert for login-flow,
 *    e2e-persistent for provisioning, public for API probes) so there is no
 *    cross-test state that would flake under parallelism.
 *  - workers: 4 in CI (self-hosted runner has plenty of CPU). Local falls
 *    back to Playwright default (2 cores typical).
 *  - retries: 2 in CI to survive flaky network (staging link to OVH drops
 *    sometimes, Supabase 429s on bursts). 0 locally for speed.
 *  - trace + screenshot on failure only — green runs stay cheap.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  use: {
    baseURL: process.env.PROSPECTION_URL || process.env.BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects,
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run start",
        port: 3000,
        reuseExistingServer: true,
      },
});
