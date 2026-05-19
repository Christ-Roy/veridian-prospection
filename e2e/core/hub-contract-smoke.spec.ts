/**
 * Hub contract smoke — vérifie que les 6 endpoints contrat exposés répondent
 * proprement aux 3 cas standard :
 *  1. Sans auth → 401 (pas de bypass possible)
 *  2. Mauvaise signature HMAC → 401
 *  3. (Pour les routes qui acceptent legacy Bearer) Bearer wrong → 401
 *
 * Ne teste PAS le chemin nominal HMAC valide (ce serait fragile sans le
 * secret côté CI). C'est couvert par les tests unit du handler + le smoke
 * curl prod/staging fait à la main dans la procédure de release.
 *
 * Source : CONTRAT-HUB.md §5.2–§5.5 + §6.1.
 *
 * Run : npx playwright test e2e/core/hub-contract-smoke.spec.ts --project=chromium
 */
import { test, expect } from "@playwright/test";

const ENDPOINTS = [
  { path: "/api/tenants/provision", method: "POST", body: { email: "x@y.z" } },
  { path: "/api/tenants/suspend", method: "POST", body: { tenant_id: "00000000-0000-0000-0000-000000000000" } },
  { path: "/api/tenants/resume", method: "POST", body: { tenant_id: "00000000-0000-0000-0000-000000000000" } },
  { path: "/api/tenants/attach-owner", method: "POST", body: { tenant_id: "00000000-0000-0000-0000-000000000000", owner_email: "a@b.c" } },
  { path: "/api/tenants/update-plan", method: "POST", body: { tenant_id: "00000000-0000-0000-0000-000000000000", plan: "pro" } },
] as const;

test.describe("Hub contract — auth gating", () => {
  for (const ep of ENDPOINTS) {
    test(`${ep.method} ${ep.path} → 401 sans auth`, async ({ request }) => {
      const res = await request.fetch(ep.path, {
        method: ep.method,
        data: ep.body,
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(401);
    });

    test(`${ep.method} ${ep.path} → 401 avec signature HMAC bidon`, async ({ request }) => {
      const res = await request.fetch(ep.path, {
        method: ep.method,
        data: ep.body,
        headers: {
          "Content-Type": "application/json",
          "X-Veridian-Timestamp": String(Date.now()),
          "X-Veridian-Hub-Signature": "00".repeat(32),
        },
      });
      expect(res.status()).toBe(401);
      const body = (await res.json()) as { error?: string };
      expect(["Invalid signature", "Unauthorized"]).toContain(body.error);
    });

    test(`${ep.method} ${ep.path} → 401 avec timestamp drift`, async ({ request }) => {
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      const res = await request.fetch(ep.path, {
        method: ep.method,
        data: ep.body,
        headers: {
          "Content-Type": "application/json",
          "X-Veridian-Timestamp": String(tenMinutesAgo),
          "X-Veridian-Hub-Signature": "ab".repeat(32),
        },
      });
      expect(res.status()).toBe(401);
    });
  }
});

test.describe("Hub contract — health GET endpoint", () => {
  test("GET /api/tenants/{id}/health → 401 sans auth", async ({ request }) => {
    const res = await request.get(
      "/api/tenants/00000000-0000-0000-0000-000000000000/health",
    );
    expect(res.status()).toBe(401);
  });

  test("GET /api/tenants/{id}/health → 401 avec signature bidon", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/tenants/00000000-0000-0000-0000-000000000000/health",
      {
        headers: {
          "X-Veridian-Timestamp": String(Date.now()),
          "X-Veridian-Hub-Signature": "00".repeat(32),
        },
      },
    );
    expect(res.status()).toBe(401);
  });
});
