/**
 * Shared e2e auth helper — canonical persistent user.
 *
 * Why: Supabase staging rate-limits /auth/v1/signup after ~50 ephemeral users
 * per day. Previous specs created a fresh user per run via `signup`, which
 * reliably failed with HTTP 422 once the rate limit was hit. This helper
 * replaces that pattern with a single canonical user that is created once and
 * reused across all e2e specs.
 *
 * Guarantees:
 *  - Idempotent: running 10x still yields exactly one user, no pollution.
 *  - Zero dynamic signups → zero rate limit.
 *  - Single clean API: `await loginAsE2EUser(page, request)` and the page is
 *    logged in on /prospects.
 *  - Gracefully skips the calling test if ANON_KEY / SERVICE_ROLE_KEY are not
 *    provided (same pattern as the legacy helpers).
 *
 * Usage:
 *   import { loginAsE2EUser } from "./helpers/auth";
 *   test("something", async ({ page, request }) => {
 *     await loginAsE2EUser(page, request);
 *     // page is now authenticated on ${PROSPECTION_URL}/prospects
 *   });
 */
import { test, type APIRequestContext, type Page } from "@playwright/test";

export const E2E_USER_EMAIL = "e2e-persistent@yopmail.com";
export const E2E_USER_PASSWORD = "E2ePersistent2026!";
export const E2E_TENANT_NAME = "e2e-persistent";

function env(name: string, fallback = ""): string {
  return process.env[name] || fallback;
}

/**
 * Ensure the canonical e2e user exists in Supabase and log in via the
 * prospection dashboard /login form.
 *
 * The function is idempotent:
 *  1. Attempts `signInWithPassword` first (hot path — user already exists).
 *  2. On failure, creates the user via `POST /auth/v1/admin/users` with
 *     `email_confirm: true` (service role), then retries login.
 *  3. Provisions the tenant (also idempotent on the prospection side).
 *  4. Fills the /login form and waits for redirect to /prospects.
 *
 * Throws if login fails after creation — that indicates a real config issue
 * (bad keys, tenant provisioning broken, form markup changed), not a rate
 * limit.
 */
export async function loginAsE2EUser(
  page: Page,
  request: APIRequestContext
): Promise<void> {
  const PROSPECTION_URL = env(
    "PROSPECTION_URL",
    "https://saas-prospection.staging.veridian.site"
  );
  const SUPABASE_URL = env(
    "SUPABASE_URL",
    "https://saas-api.staging.veridian.site"
  );
  const ANON_KEY = env("SUPABASE_ANON_KEY");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  const TENANT_SECRET = env(
    "TENANT_API_SECRET",
    "staging-prospection-secret-2026"
  );

  if (!ANON_KEY || !SERVICE_KEY) {
    test.skip(
      true,
      "SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY required for loginAsE2EUser"
    );
    return;
  }

  // Step 1: try signing in with the canonical password. If it works, the
  // user already exists — we skip creation entirely.
  let loginOk = await canSignIn(request, SUPABASE_URL, ANON_KEY);

  // Step 2: if login failed, create the user via admin API (service role).
  // `email_confirm: true` bypasses the email verification step.
  if (!loginOk) {
    const createRes = await request.post(
      `${SUPABASE_URL}/auth/v1/admin/users`,
      {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        data: {
          email: E2E_USER_EMAIL,
          password: E2E_USER_PASSWORD,
          email_confirm: true,
        },
      }
    );
    // 200/201 = created, 422 = already exists (race with another spec) —
    // both are fine, we re-verify with signInWithPassword below.
    if (!createRes.ok() && createRes.status() !== 422) {
      const body = await createRes.text().catch(() => "");
      throw new Error(
        `Failed to create e2e user: ${createRes.status()} ${body}`
      );
    }
    loginOk = await canSignIn(request, SUPABASE_URL, ANON_KEY);
    if (!loginOk) {
      throw new Error(
        "Canonical e2e user exists but signInWithPassword still fails — check SERVICE_ROLE_KEY / password drift"
      );
    }
  }

  // Step 3: provision the tenant (idempotent on the prospection side —
  // repeated calls just return the existing tenant).
  const provisionRes = await request.post(
    `${PROSPECTION_URL}/api/tenants/provision`,
    {
      headers: {
        Authorization: `Bearer ${TENANT_SECRET}`,
        "Content-Type": "application/json",
      },
      data: {
        email: E2E_USER_EMAIL,
        name: E2E_TENANT_NAME,
        plan: "freemium",
      },
    }
  );
  if (!provisionRes.ok() && provisionRes.status() !== 409) {
    const body = await provisionRes.text().catch(() => "");
    // 409 = tenant already exists → fine. Anything else → hard fail.
    throw new Error(
      `Tenant provision failed: ${provisionRes.status()} ${body}`
    );
  }

  // Step 4: mark onboarding as done so the modal doesn't block e2e tests.
  // Uses the session cookie from the provision step — the settings API
  // requires auth but the login hasn't happened yet in the browser.
  // We'll do it after login via page.evaluate instead.

  // Step 5: fill the /login form and wait for redirect.
  await page.goto(`${PROSPECTION_URL}/login`);
  await page.locator("#email").fill(E2E_USER_EMAIL);
  await page.locator("#password").fill(E2E_USER_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page
    .waitForURL(/\/(prospects|$)/, { timeout: 20000 })
    .catch(() => {});
  if (page.url().includes("/login")) {
    throw new Error(`Login failed, still on ${page.url()}`);
  }

  // Step 6: set onboarding_done to suppress the onboarding modal.
  // Now that we're logged in, the session cookie is set and we can
  // call the settings API from the browser context.
  await page.evaluate(async () => {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_done: "true" }),
    }).catch(() => {});
  });

  // Dismiss the onboarding modal if it appeared (click the skip button)
  const skipBtn = page.locator('[data-testid="onboarding-skip"]');
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Try to obtain a Supabase access token for the canonical user. Returns
 * `true` if the credentials are valid, `false` otherwise. Never throws — a
 * network error is treated as "cannot sign in" so the caller falls through
 * to the admin-create path.
 */
async function canSignIn(
  request: APIRequestContext,
  supabaseUrl: string,
  anonKey: string
): Promise<boolean> {
  try {
    const res = await request.post(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        headers: {
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        data: {
          email: E2E_USER_EMAIL,
          password: E2E_USER_PASSWORD,
        },
      }
    );
    return res.ok();
  } catch {
    return false;
  }
}
