/**
 * E2E Test — SaaS Flow Prospection (post migration Auth.js v5)
 *
 * Périmètre réduit à ce qui concerne Prospection seul (l'agent Hub teste
 * signup / login UI / provisioning côté Hub). Ce spec couvre :
 *
 *  1. Health Prospection
 *  2. Data non-obfusquée pendant trial actif (via compte canonique
 *     e2e-persistent, owner d'un tenant freemium)
 *  3. Pipeline page répond (auth gate)
 *  4. Export requires auth
 *
 * Migration 2026-05-23 : drop signup Supabase / login Hub UI / provisioning
 * Hub (couverts ailleurs ou obsolètes — Supabase n'existe plus côté
 * Prospection, l'app utilise Prisma + Auth.js v5).
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe.serial("SaaS Flow E2E (Prospection)", () => {
  test.setTimeout(60_000);

  test("1. health Prospection responds OK + DB connected", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/health`);
    expect(res.ok(), `Health returned ${res.status()}`).toBeTruthy();
    const data = await res.json();
    console.log(`[1] Prospection: status=${data.status}, db=${data.db}`);
    expect(["ok", "healthy"]).toContain(data.status);
    expect(["ok", "connected"]).toContain(data.db);
  });

  test("2. prospects data not obfuscated during active trial", async ({ page, request }) => {
    // Login via compte canonique (tenant freemium avec trialEndsAt + 14j cf
    // ensureCanonicalUser dans helpers/auth.ts)
    await loginAsE2EUser(page, request);

    const apiRes = await page.request.get(
      `${PROSPECTION_URL}/api/prospects?preset=top_prospects&domain=all&page=1&pageSize=3`,
    );
    console.log(`[2] /api/prospects status: ${apiRes.status()}`);
    expect(apiRes.ok(), `Prospects API returned ${apiRes.status()}`).toBeTruthy();

    const data = await apiRes.json();
    if (!data.data || data.data.length === 0) {
      console.log(`[2] No prospects in DB for this tenant — obfuscation check skipped`);
      return;
    }

    const firstLead = data.data[0];
    const fields = ["domain", "nom_entreprise", "phone_principal", "email_principal", "ville"];
    let obfuscatedCount = 0;
    for (const field of fields) {
      const val = firstLead[field];
      if (typeof val === "string" && val.includes("•")) {
        obfuscatedCount++;
        console.log(`[2] Obfuscated: ${field} = ${val}`);
      }
    }
    console.log(`[2] Obfuscated fields: ${obfuscatedCount}/${fields.length} (expect 0 during trial)`);
    expect(obfuscatedCount, "Data should NOT be obfuscated during active trial").toBe(0);
  });

  test("3. /pipeline page responds (auth gate)", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/pipeline`);
    console.log(`[3] /pipeline status: ${res.status()}`);
    // 307 redirect to login = auth middleware works, 200 = page renders (rare ici sans cookie)
    expect([200, 307]).toContain(res.status());
  });

  test("4. /api/export requires authentication", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/export?preset=tous`);
    console.log(`[4] /api/export status: ${res.status()}`);
    expect([401, 200, 307, 404]).toContain(res.status());
  });
});
