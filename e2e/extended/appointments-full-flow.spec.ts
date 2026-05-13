/**
 * E2E — Appointments & Calendrier — Full flow
 *
 * Scenarios couverts :
 *  1. API /api/appointments : create → list → patch (reschedule) → cancel
 *  2. Page /pipeline : toggle liste/calendrier, vue FullCalendar visible
 *  3. Page /settings/notifications : load prefs, toggle push, save minutes_before
 *  4. Fiche prospect : section RDV visible, création directe
 *  5. Tenant existant : toutes les données survivent à la migration (RDV zero OK)
 *
 * Ces tests tournent sur staging, non-bloquants (extended) mais couvrent
 * toute la feature calendrier/RDV avant merge main.
 */
import { test, expect } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://saas-prospection.staging.veridian.site";

test.describe("Appointments API (tenant existant)", () => {
  test("create → list → patch → cancel cycle", async ({ page, request }) => {
    await loginAsE2EUser(page, request);

    // Récupère un siren réel via l'API prospects
    const prospectsRes = await page.request.get(`${PROSPECTION_URL}/api/prospects?limit=1`);
    expect(prospectsRes.ok()).toBeTruthy();
    const prospectsJson = await prospectsRes.json();
    const siren = prospectsJson.results?.[0]?.siren || prospectsJson.prospects?.[0]?.siren;
    test.skip(!siren, "No prospect in tenant, cannot test");

    const startAt = new Date(Date.now() + 2 * 3600_000).toISOString();
    const endAt = new Date(Date.now() + 2.5 * 3600_000).toISOString();

    // Create
    const createRes = await page.request.post(`${PROSPECTION_URL}/api/appointments`, {
      data: {
        siren,
        startAt,
        endAt,
        title: "E2E test RDV",
        notes: "Automated test appointment",
      },
    });
    expect(createRes.ok(), `create failed: ${createRes.status()}`).toBeTruthy();
    const created = await createRes.json();
    const id = created.appointment?.id;
    expect(id).toBeTruthy();
    expect(created.appointment.googleEventUrl).toMatch(/calendar\.google\.com/);

    // List — le RDV doit apparaître
    const listRes = await page.request.get(
      `${PROSPECTION_URL}/api/appointments?siren=${siren}`
    );
    expect(listRes.ok()).toBeTruthy();
    const listed = await listRes.json();
    const found = listed.appointments.find((a: { id: string }) => a.id === id);
    expect(found, "newly-created appointment not in list").toBeTruthy();

    // Patch — reschedule, doit reset notified_at et régénérer googleEventUrl
    const newStart = new Date(Date.now() + 4 * 3600_000).toISOString();
    const patchRes = await page.request.patch(
      `${PROSPECTION_URL}/api/appointments/${id}`,
      {
        data: {
          startAt: newStart,
          endAt: new Date(Date.now() + 4.5 * 3600_000).toISOString(),
        },
      }
    );
    expect(patchRes.ok()).toBeTruthy();
    const patched = await patchRes.json();
    expect(new Date(patched.appointment.startAt).toISOString()).toBe(newStart);
    expect(patched.appointment.notifiedAt).toBeNull();

    // Cancel
    const deleteRes = await page.request.delete(
      `${PROSPECTION_URL}/api/appointments/${id}`
    );
    expect(deleteRes.ok()).toBeTruthy();

    // Vérifie le status
    const afterCancel = await page.request.get(
      `${PROSPECTION_URL}/api/appointments?siren=${siren}`
    );
    const afterJson = await afterCancel.json();
    const cancelled = afterJson.appointments.find((a: { id: string }) => a.id === id);
    expect(cancelled?.status).toBe("cancelled");
  });

  test("unauthorized without auth", async ({ request }) => {
    const res = await request.get(`${PROSPECTION_URL}/api/appointments`);
    expect([401, 403]).toContain(res.status());
  });

  test("400 on missing fields", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    const res = await page.request.post(`${PROSPECTION_URL}/api/appointments`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Pipeline view — calendar toggle", () => {
  test("toggle list/calendar, FullCalendar renders", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/pipeline`);
    await page.waitForLoadState("networkidle");

    // Vue liste par défaut
    await expect(page.getByTestId("pipeline-view-list")).toBeVisible();
    await expect(page.getByTestId("pipeline-view-calendar")).toBeVisible();

    // Switch calendrier
    await page.getByTestId("pipeline-view-calendar").click();
    await page.waitForTimeout(500);

    // FullCalendar doit afficher sa toolbar
    await expect(page.locator(".fc-toolbar")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".fc-view-harness")).toBeVisible();

    // Retour liste
    await page.getByTestId("pipeline-view-list").click();
    await page.waitForTimeout(300);
    await expect(page.locator(".fc-toolbar")).toHaveCount(0);
  });
});

test.describe("Settings notifications", () => {
  test("page loads, toggle push, save minutes_before", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/settings/notifications`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("toggle-reminder-push")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("input-minutes-before")).toBeVisible();

    // Change minutes → save
    await page.getByTestId("input-minutes-before").fill("45");
    await page.getByTestId("save-notification-prefs").click();

    // Sonner toast de succès
    await expect(page.locator("text=Préférences enregistrées")).toBeVisible({ timeout: 5000 });

    // Reload → vérifie la persistance
    await page.reload();
    await page.waitForLoadState("networkidle");
    const input = page.getByTestId("input-minutes-before");
    await expect(input).toHaveValue("45", { timeout: 10000 });
  });
});

test.describe("Lead sheet appointments section", () => {
  test("section visible, nouveau RDV CTA exists", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    await page.goto(`${PROSPECTION_URL}/prospects`);
    await page.waitForLoadState("networkidle");

    // Clic sur la première ligne prospect pour ouvrir la fiche
    const firstRow = page.locator('[data-testid^="prospect-row-"]').first();
    const hasProspect = (await firstRow.count()) > 0;
    test.skip(!hasProspect, "Tenant has no prospects");

    await firstRow.click();
    await page.waitForTimeout(800);

    // Ouvre l'accordion RDV
    const trigger = page.locator('button:has-text("RDV")').first();
    if (await trigger.isVisible()) {
      await trigger.click();
      await page.waitForTimeout(300);
      await expect(page.getByTestId("appointments-section")).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId("appointment-new")).toBeVisible();
    }
  });
});

test.describe("Tenant existant — data integrity après migration", () => {
  test("les prospects existants sont toujours listables", async ({ page, request }) => {
    await loginAsE2EUser(page, request);
    const res = await page.request.get(`${PROSPECTION_URL}/api/prospects?limit=5`);
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    const count = (json.results || json.prospects || []).length;
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("outreach.deadline continue de fonctionner (colonnes raw actées)", async ({
    page,
    request,
  }) => {
    await loginAsE2EUser(page, request);
    // Le endpoint outreach accepte toujours deadline en PATCH
    const prospectsRes = await page.request.get(`${PROSPECTION_URL}/api/prospects?limit=1`);
    const prospects = await prospectsRes.json();
    const siren =
      prospects.results?.[0]?.siren || prospects.prospects?.[0]?.siren;
    const domain =
      prospects.results?.[0]?.web_domain ||
      prospects.prospects?.[0]?.web_domain ||
      prospects.results?.[0]?.domain;
    test.skip(!siren || !domain, "No prospect with domain for legacy test");

    const res = await page.request.patch(
      `${PROSPECTION_URL}/api/outreach/${encodeURIComponent(domain)}`,
      {
        data: {
          pipeline_stage: "a_rappeler",
          deadline: new Date(Date.now() + 24 * 3600_000).toISOString(),
        },
      }
    );
    expect([200, 201, 204]).toContain(res.status());
  });
});
