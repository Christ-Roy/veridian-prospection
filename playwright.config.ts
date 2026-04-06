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

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.PROSPECTION_URL || process.env.BASE_URL || "http://localhost:3000",
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
