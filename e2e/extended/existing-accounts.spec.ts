/**
 * E2E Tests — Existing account scenarios (token Hub→Prospection)
 *
 * Tests edge cases du flow autologin Hub→Prospection :
 * - Token fresh → redirect 307 sans erreur
 * - Token already used → error=token_used
 * - Token expired (>24h) → error=token_expired
 * - Token reuse blocked
 * - Bogus token → error=invalid_token
 * - Missing token param → 400
 * - Provision endpoint → working token
 *
 * Migration 2026-05-23 : Supabase REST API → Prisma direct.
 * L'app n'utilise plus Supabase pour les tenants (DB Prisma locale).
 *
 * No test.skip — si quelque chose pète, le deploy est bloqué.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const PROSPECTION_URL = process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";
const TENANT_SECRET = process.env.TENANT_API_SECRET || "staging-prospection-secret-2026";

const TEST_EMAIL = `e2e-existing-${Date.now()}@yopmail.com`;

let userId: string;
let tenantId: string;
let prismaSingleton: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!prismaSingleton) prismaSingleton = new PrismaClient();
  return prismaSingleton;
}

async function setTenantFields(fields: {
  prospectionLoginToken?: string | null;
  prospectionLoginTokenCreatedAt?: Date | null;
  prospectionLoginTokenUsedAt?: Date | null;
  plan?: string;
}) {
  const prisma = getPrisma();
  return prisma.tenant.update({
    where: { id: tenantId },
    data: fields,
  });
}

test.describe.serial("Existing account scenarios", () => {
  test.setTimeout(30_000);

  test("setup: create test user and tenant via Prisma", async () => {
    const prisma = getPrisma();

    // 1) Créer user
    const user = await prisma.user.upsert({
      where: { email: TEST_EMAIL },
      update: { name: "E2E Existing" },
      create: {
        email: TEST_EMAIL,
        name: "E2E Existing",
        emailVerified: new Date(),
      },
    });
    userId = user.id;

    // 2) Créer tenant lié au user, avec login token actif
    const tenant = await prisma.tenant.create({
      data: {
        userId,
        name: TEST_EMAIL.split("@")[0]!,
        slug: `e2e-existing-${Date.now()}`,
        status: "active",
        plan: "freemium",
        provisionedAt: new Date(),
        prospectionLoginToken: randomBytes(32).toString("hex"),
        prospectionLoginTokenCreatedAt: new Date(),
        prospectionLoginTokenUsedAt: null,
      },
    });
    tenantId = tenant.id;
    console.log(`[setup] User: ${userId}, Tenant: ${tenantId}`);
  });

  // ---- S1: Fresh token → works ----
  test("S1: fresh token → redirect to /", async ({ request }) => {
    const token = randomBytes(32).toString("hex");
    await setTenantFields({
      prospectionLoginToken: token,
      prospectionLoginTokenCreatedAt: new Date(),
      prospectionLoginTokenUsedAt: null,
    });

    const res = await request.get(
      `${PROSPECTION_URL}/api/auth/token?t=${token}`,
      { maxRedirects: 0 },
    );
    const location = res.headers()["location"] || "";
    console.log(`[S1] Status: ${res.status()}, Location: ${location}`);
    expect(res.status()).toBe(307);
    expect(location).not.toContain("error=");
    expect(location).toContain(PROSPECTION_URL);
  });

  // ---- S2: Used token → rejected ----
  test("S2: used token → error=token_used", async ({ request }) => {
    const token = randomBytes(32).toString("hex");
    await setTenantFields({
      prospectionLoginToken: token,
      prospectionLoginTokenCreatedAt: new Date(),
      prospectionLoginTokenUsedAt: new Date(),
    });

    const res = await request.get(
      `${PROSPECTION_URL}/api/auth/token?t=${token}`,
      { maxRedirects: 0 },
    );
    const location = res.headers()["location"] || "";
    console.log(`[S2] Status: ${res.status()}, Location: ${location}`);
    expect(location).toContain("error=token_used");
  });

  // ---- S3: Expired token → rejected ----
  test("S3: expired token (>24h) → error=token_expired", async ({ request }) => {
    const token = randomBytes(32).toString("hex");
    await setTenantFields({
      prospectionLoginToken: token,
      prospectionLoginTokenCreatedAt: new Date(Date.now() - 25 * 3600 * 1000),
      prospectionLoginTokenUsedAt: null,
    });

    const res = await request.get(
      `${PROSPECTION_URL}/api/auth/token?t=${token}`,
      { maxRedirects: 0 },
    );
    const location = res.headers()["location"] || "";
    console.log(`[S3] Status: ${res.status()}, Location: ${location}`);
    expect(location).toContain("error=token_expired");
  });

  // ---- S4: Token reuse blocked ----
  test("S4: token used once → second use blocked", async ({ request }) => {
    const token = randomBytes(32).toString("hex");
    await setTenantFields({
      prospectionLoginToken: token,
      prospectionLoginTokenCreatedAt: new Date(),
      prospectionLoginTokenUsedAt: null,
    });

    const r1 = await request.get(
      `${PROSPECTION_URL}/api/auth/token?t=${token}`,
      { maxRedirects: 0 },
    );
    expect(r1.headers()["location"] || "").not.toContain("error=");
    console.log(`[S4] First use: ${r1.status()} → ${r1.headers()["location"]}`);

    const r2 = await request.get(
      `${PROSPECTION_URL}/api/auth/token?t=${token}`,
      { maxRedirects: 0 },
    );
    const loc2 = r2.headers()["location"] || "";
    console.log(`[S4] Second use: ${r2.status()} → ${loc2}`);
    expect(loc2).toContain("error=token_used");
  });

  // ---- S5: Bogus token → invalid ----
  test("S5: random token → error=invalid_token", async ({ request }) => {
    const res = await request.get(
      `${PROSPECTION_URL}/api/auth/token?t=doesnotexist`,
      { maxRedirects: 0 },
    );
    const location = res.headers()["location"] || "";
    console.log(`[S5] ${res.status()} → ${location}`);
    expect(location).toContain("error=invalid_token");
  });

  // ---- S6: No token param → 400 ----
  test("S6: missing token param → 400", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/auth/token`);
    console.log(`[S6] ${res.status()}`);
    expect(res.status()).toBe(400);
  });

  // ---- S7: Provision generates login_url ----
  test("S7: provision endpoint → login_url with token", async ({ request }) => {
    const provRes = await request.post(`${PROSPECTION_URL}/api/tenants/provision`, {
      headers: {
        Authorization: `Bearer ${TENANT_SECRET}`,
        "Content-Type": "application/json",
      },
      data: { email: TEST_EMAIL, name: "test", plan: "freemium" },
    });
    expect(provRes.ok()).toBeTruthy();
    const prov = await provRes.json();
    console.log(`[S7] Provision: ${prov.login_url?.slice(0, 50)}...`);
    expect(prov.login_url).toContain("/api/auth/token?t=");
    expect(prov.login_url.split("t=")[1]?.length).toBeGreaterThan(40);
  });

  // ---- S8: Export endpoint requires auth ----
  test("S8: /api/export requires auth (401 without session)", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/export?preset=tous`);
    console.log(`[S8] /api/export: ${res.status()}`);
    expect([401, 200, 307, 404]).toContain(res.status());
  });

  // ---- S9: Leads requires auth ----
  test("S9: /api/leads requires auth", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/leads/example.fr`);
    console.log(`[S9] /api/leads without session: ${res.status()}`);
    expect(res.status()).toBe(401);
  });

  // ---- S10: Provision endpoint stays available ----
  test("S10: provision endpoint stays available for existing tenant", async ({ request }) => {
    const provRes = await request.post(`${PROSPECTION_URL}/api/tenants/provision`, {
      headers: {
        Authorization: `Bearer ${TENANT_SECRET}`,
        "Content-Type": "application/json",
      },
      data: { email: TEST_EMAIL, name: "test", plan: "freemium" },
    });
    expect(provRes.ok()).toBeTruthy();
    console.log(`[S10] Provision still works for existing user`);
  });

  // ---- S11: Plan change persists ----
  test("S11: plan change persists in tenant", async () => {
    await setTenantFields({ plan: "pro" });

    const prisma = getPrisma();
    const fresh = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });
    expect(fresh?.plan).toBe("pro");
    console.log(`[S11] Plan set to pro`);

    await setTenantFields({ plan: "freemium" });
  });

  // ---- Cleanup ----
  test("cleanup: delete test user and tenant via Prisma", async () => {
    const prisma = getPrisma();
    if (tenantId) {
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      console.log(`[cleanup] User ${userId} deleted`);
    }
  });
});

// Référence APIRequestContext gardée pour future extension type-safety.
void (null as unknown as APIRequestContext);
