/**
 * API smoke tests — SIREN-centric (replacement for the legacy smoke.spec.ts).
 *
 * These tests don't require a logged-in browser session. They only hit public
 * endpoints (/api/health) and verify that protected endpoints are auth-gated.
 *
 * Run: npx playwright test e2e/api-siren.spec.ts
 */
import { test, expect } from "@playwright/test";

test.describe("API health", () => {
  test("GET /api/health returns 200", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("status");
    expect(data.status).toBe("healthy");
    if ("db" in data) expect(data.db).toBe("connected");
  });
});

test.describe("Protected entreprises API (401 without auth)", () => {
  test("GET /api/entreprises → 401 without cookie", async ({ request }) => {
    const res = await request.get("/api/entreprises?limit=1");
    expect(res.status()).toBe(401);
  });

  test("GET /api/entreprises/123456789 → 401 without cookie", async ({ request }) => {
    const res = await request.get("/api/entreprises/123456789");
    expect(res.status()).toBe(401);
  });

  test("GET /api/entreprises/segments → 401 without cookie", async ({ request }) => {
    const res = await request.get("/api/entreprises/segments");
    expect(res.status()).toBe(401);
  });
});

test.describe("Legacy routes are auth-gated", () => {
  test("GET /api/stats → 401", async ({ request }) => {
    const res = await request.get("/api/stats");
    expect(res.status()).toBe(401);
  });

  test("GET /api/leads → 401", async ({ request }) => {
    const res = await request.get("/api/leads?page=1&pageSize=1");
    expect(res.status()).toBe(401);
  });

  test("GET /api/pipeline → 401", async ({ request }) => {
    const res = await request.get("/api/pipeline");
    expect(res.status()).toBe(401);
  });
});
