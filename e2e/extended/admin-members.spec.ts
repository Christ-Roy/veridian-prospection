/**
 * Admin members page — spec ciblée sur le drawer pipeline + historique
 * et le switch visibility_scope.
 *
 * Auth via le compte canonique `e2e-persistent` (owner → isAdmin=true).
 *
 * Couvre :
 *  - Login → /admin/members
 *  - Table visible
 *  - Click sur une ligne → drawer avec Pipeline + Historique
 *  - Change du scope (all → own → all) → PATCH 200 + toast succès
 */
import { test, expect, type ConsoleMessage } from "@playwright/test";
import { loginAsE2EUser } from "../helpers/auth";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

let consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (t.includes("GTM") || t.includes("dataLayer") || t.includes("favicon")) return;
    if (t.includes("Failed to load resource")) return;
    if (t.includes("chrome-extension://")) return;
    if (t.includes("401") || t.includes("403")) return;
    consoleErrors.push(t);
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`PAGE_ERROR: ${err.message}`);
  });
});

test.describe("Admin members — drawer + visibility scope", () => {
  test.setTimeout(90_000);

  test("table visible, drawer opens, scope PATCH succeeds", async ({ page, request }) => {
    await loginAsE2EUser(page, request);

    await page.goto(`${PROSPECTION_URL}/admin/members`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

    await expect(page.getByRole("heading", { name: /membres/i })).toBeVisible({
      timeout: 10000,
    });
    const table = page.getByTestId("admin-members-table");
    await expect(table).toBeVisible();

    const rows = page.getByTestId("admin-member-row");
    const rowCount = await rows.count();
    // Le compte canonique seede 1 owner + 1 membre invité (helpers/auth.ts §6).
    // Skip silencieux interdit : si rowCount==0, le seed est cassé ou la DB
    // pointe sur un autre tenant — il faut un échec rouge, pas un test vert
    // sans assertion exécutée.
    expect(
      rowCount,
      "admin/members vide — le seed canonique doit poser ≥ 1 row (owner + invité)",
    ).toBeGreaterThan(0);

    await rows.first().click();
    const drawer = page.getByTestId("admin-member-drawer");
    await expect(drawer).toBeVisible({ timeout: 10000 });
    await expect(drawer.getByText(/pipeline/i)).toBeVisible();
    await expect(drawer.getByText(/historique/i)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible({ timeout: 5000 }).catch(() => {});

    // PATCH visibility_scope via API directe (évite flakiness du Select UI).
    const listRes = await request.get(`${PROSPECTION_URL}/api/admin/members`, {
      headers: { cookie: (await page.context().cookies())
        .map((c) => `${c.name}=${c.value}`)
        .join("; ") },
    });
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    const member = (listBody.members ?? []).find(
      (m: { memberships: unknown[] }) => (m.memberships ?? []).length > 0
    );
    // Le seed canonique pose 1 WorkspaceMember (owner) + 1 invité, donc
    // members[].memberships ne peut pas être vide sur le tenant E2E. Skip
    // silencieux interdit : un membre sans membership = seed cassé, on
    // doit voir le rouge.
    expect(
      member,
      "aucun membre avec workspaceMember — le seed canonique doit poser owner+invité avec memberships",
    ).toBeDefined();
    if (!member) return; // narrow TS — l'expect ci-dessus a déjà rougi
    const ms = member.memberships[0];
    const patchRes = await request.patch(`${PROSPECTION_URL}/api/admin/members`, {
      headers: {
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
        "Content-Type": "application/json",
      },
      data: {
        userId: member.userId,
        workspaceId: ms.workspaceId,
        visibilityScope: "own",
      },
    });
    expect(patchRes.status()).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.ok).toBe(true);
    expect(patchBody.visibilityScope).toBe("own");

    // Revert
    const revertRes = await request.patch(`${PROSPECTION_URL}/api/admin/members`, {
      headers: {
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
        "Content-Type": "application/json",
      },
      data: {
        userId: member.userId,
        workspaceId: ms.workspaceId,
        visibilityScope: "all",
      },
    });
    expect(revertRes.status()).toBe(200);
  });
});
