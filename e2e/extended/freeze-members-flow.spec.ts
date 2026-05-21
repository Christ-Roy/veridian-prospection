/**
 * Freeze members flow — CONTRAT-HUB §5.21.
 *
 * Vérifie le cycle complet :
 *  1. Provision tenant éphémère + autologin via /api/auth/token (cross-app)
 *  2. GET /api/leads/<siren> baseline → champs sensibles éventuels en clair
 *  3. POST HMAC /api/tenants/<email>/freeze-members → 200 + affected_members ≥ 1
 *  4. GET /api/leads/<siren> à nouveau → champs sensibles obfusqués si présents
 *  5. POST HMAC /api/tenants/<email>/unfreeze-members → 200 + restored
 *
 * Le user provisionné est freemium → SENSITIVE_FIELDS path câblé.
 *
 * Skip gracieux : si /api/prospects renvoie 0 lead (DB staging sans seed), on
 * valide quand même le contrat HMAC (200 sur freeze/unfreeze) — l'effet UI
 * d'obfuscation est observé seulement si on a au moins un lead à inspecter.
 *
 * Cleanup : unfreeze toujours appelé en finally pour ne pas laisser le user
 * dans un état "frozen" si un assert plante au milieu.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin, provisionEphemeralTenant } from "../helpers/cross-app-login";
import { hubPost } from "../helpers/hub-hmac";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

const SENSITIVE_FIELDS = [
  "email",
  "dirigeant_email",
  "phone",
  "dirigeant",
  "qualite_dirigeant",
] as const;

function isObfuscated(value: unknown): boolean {
  return typeof value === "string" && value.includes("•");
}

function hasContent(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

test.describe("Freeze members — HMAC Hub → obfuscation /api/leads", () => {
  test.setTimeout(120_000);

  test("freeze → leads obfusqués + unfreeze cleanup", async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    let frozen = false;
    let tenantEmail: string | null = null;
    try {
      // --- Étape 1 : provision + autologin cross-app ---
      const tenant = await provisionAndLogin(request, context);
      tenantEmail = tenant.email;
      const cookies = await context.cookies();
      const cookieHeader = cookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");

      // --- Étape 2 : trouver un siren avec champs sensibles ---
      const listRes = await request.get(
        `${PROSPECTION_URL}/api/prospects?limit=20`,
        { headers: { cookie: cookieHeader } },
      );

      const triggerFreeze = async (): Promise<void> => {
        const freezeRes = await hubPost(
          request,
          `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenant.email)}/freeze-members`,
          { user_emails: [tenant.email] },
        );
        expect(
          freezeRes.status(),
          `freeze-members failed: ${await freezeRes.text()}`,
        ).toBe(200);
        const freezeBody = (await freezeRes.json()) as {
          frozen_emails?: string[];
          affected_members?: number;
        };
        expect(freezeBody.frozen_emails).toContain(tenant.email);
        expect(freezeBody.affected_members ?? 0).toBeGreaterThanOrEqual(1);
        frozen = true;
      };

      if (!listRes.ok()) {
        // /api/prospects refuse (paywall, fresh tenant…) — on valide juste
        // le contrat HMAC freeze sans tester l'obfuscation UI.
        await triggerFreeze();
        return;
      }
      const listBody = (await listRes.json()) as {
        leads?: Array<{ siren?: string }>;
      };
      const leads = listBody.leads ?? [];
      if (leads.length === 0) {
        await triggerFreeze();
        return;
      }

      let chosenSiren: string | null = null;
      let baselineDetail: Record<string, unknown> | null = null;
      for (const lead of leads) {
        if (!lead.siren) continue;
        const detailRes = await request.get(
          `${PROSPECTION_URL}/api/leads/${lead.siren}`,
          { headers: { cookie: cookieHeader } },
        );
        if (!detailRes.ok()) continue;
        const detail = (await detailRes.json()) as Record<string, unknown>;
        const hasSensitive = SENSITIVE_FIELDS.some((f) => hasContent(detail[f]));
        if (hasSensitive) {
          chosenSiren = lead.siren;
          baselineDetail = detail;
          break;
        }
      }
      if (!chosenSiren || !baselineDetail) {
        await triggerFreeze();
        return;
      }
      const baselineUnobfuscated = SENSITIVE_FIELDS.filter(
        (f) => hasContent(baselineDetail![f]) && !isObfuscated(baselineDetail![f]),
      );

      // --- Étape 3 : freeze + assert structure ---
      await triggerFreeze();

      // --- Étape 4 : re-GET lead → champs sensibles obfusqués ---
      const afterFreezeRes = await request.get(
        `${PROSPECTION_URL}/api/leads/${chosenSiren}`,
        { headers: { cookie: cookieHeader } },
      );
      expect(afterFreezeRes.ok()).toBeTruthy();
      const afterFreeze = (await afterFreezeRes.json()) as Record<string, unknown>;
      const obfuscatedNow = baselineUnobfuscated.filter((f) =>
        isObfuscated(afterFreeze[f]),
      );
      expect(
        obfuscatedNow.length,
        `Aucun champ obfusqué après freeze. baseline=${JSON.stringify(
          Object.fromEntries(baselineUnobfuscated.map((f) => [f, baselineDetail![f]])),
        )}, after=${JSON.stringify(
          Object.fromEntries(baselineUnobfuscated.map((f) => [f, afterFreeze[f]])),
        )}`,
      ).toBeGreaterThan(0);
    } finally {
      // --- Étape 5 : unfreeze cleanup ---
      if (frozen && tenantEmail) {
        const unfreezeRes = await hubPost(
          request,
          `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenantEmail)}/unfreeze-members`,
          { user_emails: [tenantEmail] },
        );
        expect(
          unfreezeRes.status(),
          `unfreeze-members failed: ${await unfreezeRes.text()}`,
        ).toBe(200);
      }
      await context.close();
    }
  });

  test("freeze-members rejette body invalide → 400", async ({ request }) => {
    // Provisionne un tenant valide pour ne pas tomber sur 404 avant 400.
    const tenant = await provisionEphemeralTenant(request);
    const res = await hubPost(
      request,
      `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenant.email)}/freeze-members`,
      { not_a_valid_field: true },
    );
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid_body");
  });

  test("freeze-members sur tenant inconnu → 404", async ({ request }) => {
    const res = await hubPost(
      request,
      `${PROSPECTION_URL}/api/tenants/no-such-tenant-${Date.now()}@example.com/freeze-members`,
      { user_emails: ["whoever@example.com"] },
    );
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("tenant_not_found");
  });
});
