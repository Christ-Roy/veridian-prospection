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

  // Step 4: extend the tenant trial so the paywall modal doesn't block e2e.
  // Hub-side provisioning sets trial_ends_at to a short window (or NULL →
  // treated as expired by the dashboard paywall). Best-effort: resolve the
  // tenant by user_id and PATCH trial_ends_at = now + 90d. Non-blocking —
  // a failure here just means the paywall may appear; the dismiss logic in
  // step 6 handles it as a fallback.
  try {
    const usersRes = await request.get(
      `${SUPABASE_URL}/auth/v1/admin/users?per_page=200`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      }
    );
    if (usersRes.ok()) {
      const body = (await usersRes.json()) as { users?: { id: string; email?: string }[] };
      const user = body.users?.find(
        (u) => (u.email ?? "").toLowerCase() === E2E_USER_EMAIL.toLowerCase()
      );
      if (user?.id) {
        const futureIso = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        await request.patch(
          `${SUPABASE_URL}/rest/v1/tenants?user_id=eq.${user.id}`,
          {
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            data: { trial_ends_at: futureIso, prospection_plan: "freemium" },
          }
        );
      }
    }
  } catch (err) {
    console.warn(`[e2e auth] trial extension skipped: ${(err as Error).message}`);
  }

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

  // Step 7: dismiss the paywall modal if step 4's trial extension did not
  // cover this tenant (e.g. service role patch failed, tenant row not yet
  // materialized). The paywall close button is the top-right X.
  const paywallClose = page
    .locator('div.fixed.inset-0.z-50 button:has(svg.lucide-x)')
    .first();
  if (await paywallClose.isVisible({ timeout: 1500 }).catch(() => false)) {
    await paywallClose.click().catch(() => {});
    await page.waitForTimeout(300);
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
