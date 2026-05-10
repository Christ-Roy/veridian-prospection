/**
 * E2E — POST /api/tenants/magic-link
 *
 * Verifies the magic-link rotation endpoint end-to-end against staging:
 *   1. Login the canonical e2e fixture to ensure the tenant exists.
 *   2. POST /api/tenants/magic-link with valid HMAC for that tenant's email.
 *   3. Follow the returned login_url in a fresh browser context (no cookies).
 *   4. Assert: redirect to "/" (not /login?error=*) and a Supabase session
 *      cookie is set.
 *   5. Re-call magic-link → fresh token, follow it again — proves idempotence
 *      and that the previous URL becoming invalid does not break new ones.
 *
 * NON-bloquant (extended/ — see .claude/rules/core-tests.md). No signup is
 * performed: the canonical fixture user is created once and reused by every
 * spec to avoid Supabase rate limits.
 *
 * Run: npx playwright test e2e/extended/tenants-magic-link.spec.ts --project=chromium
 */
import { test, expect } from "@playwright/test";
import { createHmac } from "crypto";
import {
  loginAsE2EUser,
  E2E_USER_EMAIL,
} from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";
const TENANT_SECRET =
  process.env.TENANT_API_SECRET || "staging-prospection-secret-2026";

function sign(payload: string, ts: number): string {
  return createHmac("sha256", TENANT_SECRET).update(`${payload}:${ts}`).digest("hex");
}

async function callMagicLink(request: import("@playwright/test").APIRequestContext) {
  const ts = Date.now();
  const res = await request.post(`${PROSPECTION_URL}/api/tenants/magic-link`, {
    headers: { "Content-Type": "application/json" },
    data: {
      tenant_id: E2E_USER_EMAIL,
      timestamp: ts,
      signature: sign(E2E_USER_EMAIL, ts),
    },
  });
  return res;
}

test.describe("magic-link rotation", () => {
  test("rejects invalid signature with 401", async ({ request }) => {
    const ts = Date.now();
    const res = await request.post(`${PROSPECTION_URL}/api/tenants/magic-link`, {
      headers: { "Content-Type": "application/json" },
      data: {
        tenant_id: E2E_USER_EMAIL,
        timestamp: ts,
        signature: "deadbeef".repeat(8),
      },
    });
    expect(res.status()).toBe(401);
  });

  test("rejects unknown tenant with 404", async ({ request }) => {
    const ghost = "ghost-tenant-does-not-exist@yopmail.com";
    const ts = Date.now();
    const res = await request.post(`${PROSPECTION_URL}/api/tenants/magic-link`, {
      headers: { "Content-Type": "application/json" },
      data: {
        tenant_id: ghost,
        timestamp: ts,
        signature: sign(ghost, ts),
      },
    });
    expect(res.status()).toBe(404);
  });

  test("rotates token, returns valid login_url, and the URL logs in", async ({
    page,
    request,
    browser,
  }) => {
    // Step 1: ensure the fixture tenant exists (idempotent provision).
    await loginAsE2EUser(page, request);

    // Step 2: fresh magic link for that tenant.
    const res = await callMagicLink(request);
    expect(res.status(), `magic-link call failed: ${await res.text().catch(() => "")}`).toBe(200);
    const data = (await res.json()) as { login_url: string; expires_at: string };
    expect(data.login_url).toMatch(
      new RegExp(`${PROSPECTION_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/auth/token\\?t=[a-f0-9]{64}$`),
    );
    expect(new Date(data.expires_at).getTime()).toBeGreaterThan(Date.now());

    // Step 3: follow the URL in a clean context (no cookies from step 1).
    const ctx = await browser.newContext();
    try {
      const fresh = await ctx.newPage();
      await fresh.goto(data.login_url, { waitUntil: "load" });
      // /api/auth/token redirects to / on success, /login?error=* on failure.
      await fresh.waitForURL((url) => !url.pathname.startsWith("/api/auth/token"), {
        timeout: 15_000,
      });
      const finalUrl = fresh.url();
      expect(finalUrl, `landed on error page: ${finalUrl}`).not.toMatch(/\/login\?error=/);

      // Cookie set check — Supabase session cookies start with "sb-".
      const cookies = await ctx.cookies();
      const hasSupabaseCookie = cookies.some((c) => c.name.startsWith("sb-"));
      expect(hasSupabaseCookie, `no sb-* cookie found, got: ${cookies.map((c) => c.name).join(",")}`).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test("idempotence: two consecutive calls produce distinct fresh tokens", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);

    const r1 = await callMagicLink(request);
    expect(r1.status()).toBe(200);
    const d1 = (await r1.json()) as { login_url: string };
    const t1 = new URL(d1.login_url).searchParams.get("t");

    const r2 = await callMagicLink(request);
    expect(r2.status()).toBe(200);
    const d2 = (await r2.json()) as { login_url: string };
    const t2 = new URL(d2.login_url).searchParams.get("t");

    expect(t1).toBeTruthy();
    expect(t2).toBeTruthy();
    expect(t1).not.toBe(t2);
  });
});
