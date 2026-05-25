/**
 * Config Playwright pour les flows mail (e2e/flows-mail/).
 *
 * Cible : staging réel avec un mailpit container sur dev-pub (réseau
 * staging-edge → hostname interne `mailpit-staging`, port 1025 SMTP +
 * 8025 HTTP API). Lancé via scripts/e2e/mail-flows.sh.
 *
 * Pourquoi un config dédié (plutôt que flows-cross-app) :
 *   - Les specs mail dépendent d'un mailpit UP qu'il faut vérifier en
 *     pré-check.
 *   - L'env `MAILPIT_HTTP_URL` doit transiter (les specs en ont besoin
 *     pour interroger /api/v1/messages).
 *   - Le timeout par spec peut être plus court : pas de Stripe, pas de
 *     provision cross-app — juste UI + SMTP local.
 *
 * Mode d'exécution :
 *   - headless (container Docker sans display)
 *   - 1 worker : les specs partagent l'état de la mailbox mailpit et de
 *     la table lead_emails. Sérialiser élimine les flakes.
 *   - retries 1 : tolérer un coup ponctuel, mais pas masquer un bug réel.
 *   - timeout 60s : largement assez pour login + envoi mail + poll mailpit.
 */
import { defineConfig, devices } from "@playwright/test";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

export default defineConfig({
  testDir: "./e2e/flows-mail",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["list"], ["json", { outputFile: "e2e-flows-mail.json" }]],
  use: {
    baseURL: PROSPECTION_URL,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
