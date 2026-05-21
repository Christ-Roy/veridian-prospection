/**
 * Tenant lifecycle HMAC — CONTRAT-HUB §5.5/§5.8.
 *
 * Couvre les flows nominaux signés Hub (les négatifs auth sont déjà
 * dans `e2e/core/hub-contract-smoke.spec.ts`). Cibles :
 *  - GET /api/tenants/{id}/health → 200 + structure complète
 *  - GET /api/tenants/{id}/usage-summary → 200 + agrégats cohérents
 *  - POST /api/tenants/{id}/soft-delete → 200 → status passe à "deleted"
 *  - POST /api/tenants/{id}/restore → 200 → status passe à "suspended"
 *  - POST /api/tenants/resume → 200 → status repasse à "active"
 *
 * On provisionne un tenant éphémère via `provisionEphemeralTenant` (qui
 * envoie le `user_id` requis pour que le tenant soit réellement persisté
 * en DB — sans ce champ, provision retourne 200 mais ne crée rien).
 *
 * NB : Ce test ne purge JAMAIS — `/api/tenants/{id}/purge` est destructif
 * et délégué au cron prod.
 */
import { test, expect } from "@playwright/test";
import { hubGet, hubPost } from "../helpers/hub-hmac";
import { provisionEphemeralTenant } from "../helpers/cross-app-login";

const PROSPECTION_URL =
  process.env.PROSPECTION_URL || "https://prospection.staging.veridian.site";

test.describe("Tenant lifecycle HMAC (§5.5/§5.8)", () => {
  test.setTimeout(120_000);

  test("provision → health → usage → soft-delete → restore → resume", async ({
    request,
  }) => {
    // --- Step 1 : provision tenant éphémère via HMAC (avec user_id requis) ---
    const tenant = await provisionEphemeralTenant(request);

    // --- Step 2 : GET /health → status active + magic_link_capable ---
    const healthRes = await hubGet(
      request,
      `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenant.tenantRef)}/health`,
    );
    expect(healthRes.ok(), `health failed: ${healthRes.status()}`).toBeTruthy();
    const health = (await healthRes.json()) as {
      tenant_id?: string;
      status?: string;
      owner_attached?: boolean;
      owner_email?: string | null;
      magic_link_capable?: boolean;
      members_count?: number;
      plan?: string | null;
      checked_at?: string;
    };
    expect(health.status).toBe("active");
    expect(health.owner_attached).toBe(true);
    expect(health.owner_email).toBe(tenant.email);
    expect(health.magic_link_capable).toBe(true);
    expect(health.members_count).toBeGreaterThanOrEqual(1);
    expect(health.plan).toBe("freemium");
    expect(health.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // --- Step 3 : GET /usage-summary → structure correcte ---
    const usageRes = await hubGet(
      request,
      `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenant.tenantRef)}/usage-summary`,
    );
    expect(usageRes.ok(), `usage-summary failed: ${usageRes.status()}`).toBeTruthy();
    const usage = (await usageRes.json()) as {
      tenant_id?: string;
      data_volume?: { rows_total?: number; size_mb_estimate?: number };
      domain_specific?: {
        workspaces_count?: number;
        active_members_count?: number;
      };
    };
    expect(usage.data_volume?.rows_total).toBeGreaterThanOrEqual(0);
    expect(usage.domain_specific?.workspaces_count).toBeGreaterThanOrEqual(1);
    expect(usage.domain_specific?.active_members_count).toBeGreaterThanOrEqual(1);

    // --- Step 4 : POST /soft-delete → status passe à "deleted" ---
    const purgeEligibleAt = new Date(Date.now() + 90 * 86400_000).toISOString();
    const softDeleteRes = await hubPost(
      request,
      `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenant.tenantRef)}/soft-delete`,
      { reason: "user_request", purge_eligible_at: purgeEligibleAt },
    );
    expect(
      softDeleteRes.ok(),
      `soft-delete failed: ${softDeleteRes.status()} ${await softDeleteRes.text()}`,
    ).toBeTruthy();
    const sdBody = (await softDeleteRes.json()) as {
      soft_deleted_at?: string;
      purge_eligible_at?: string;
      previous_status?: string;
    };
    expect(sdBody.previous_status).toBe("active");
    expect(sdBody.soft_deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Health doit refléter le status "deleted" et magic_link désactivé.
    const healthAfterDeleteRes = await hubGet(
      request,
      `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenant.tenantRef)}/health`,
    );
    expect(healthAfterDeleteRes.ok()).toBeTruthy();
    const healthAfterDelete = (await healthAfterDeleteRes.json()) as {
      status?: string;
      magic_link_capable?: boolean;
    };
    expect(healthAfterDelete.status).toBe("deleted");
    expect(healthAfterDelete.magic_link_capable).toBe(false);

    // Idempotence : re-soft-delete → 200 no-op.
    const softDeleteAgainRes = await hubPost(
      request,
      `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenant.tenantRef)}/soft-delete`,
      { reason: "user_request", purge_eligible_at: purgeEligibleAt },
    );
    expect(softDeleteAgainRes.status()).toBe(200);

    // --- Step 5 : POST /restore → status passe à "suspended" ---
    const restoreRes = await hubPost(
      request,
      `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenant.tenantRef)}/restore`,
      { reason: "user_changed_mind" },
    );
    expect(
      restoreRes.ok(),
      `restore failed: ${restoreRes.status()} ${await restoreRes.text()}`,
    ).toBeTruthy();
    const restoreBody = (await restoreRes.json()) as {
      restored_at?: string;
      new_status?: string;
    };
    expect(restoreBody.new_status).toBe("suspended");

    const healthAfterRestoreRes = await hubGet(
      request,
      `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenant.tenantRef)}/health`,
    );
    const healthAfterRestore = (await healthAfterRestoreRes.json()) as {
      status?: string;
      magic_link_capable?: boolean;
    };
    expect(healthAfterRestore.status).toBe("suspended");
    // magic_link_capable doit redevenir true (owner toujours attaché, plus de deletedAt)
    expect(healthAfterRestore.magic_link_capable).toBe(true);

    // Re-restore sur tenant non soft-deleted → 409 tenant_not_soft_deleted.
    const restoreAgainRes = await hubPost(
      request,
      `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenant.tenantRef)}/restore`,
      { reason: "noop" },
    );
    expect(restoreAgainRes.status()).toBe(409);
    const restoreAgainBody = (await restoreAgainRes.json()) as { error?: string };
    expect(restoreAgainBody.error).toBe("tenant_not_soft_deleted");

    // --- Step 6 : POST /resume → status revient à "active" ---
    // resume route n'utilise PAS resolveTenantByIdOrEmail (cf todo/2026-05-21
    // -tenant-id-accept-email-or-uuid.md — patché partiellement seulement).
    // Il faut donc lui passer l'UUID local, pas l'email. On le récupère via
    // /health (qui retourne `tenant_id: <uuid>` dans le body, peu importe la
    // forme passée en URL).
    const uuid = (health as { tenant_id?: string }).tenant_id ?? tenant.tenantRef;
    const resumeRes = await hubPost(
      request,
      `${PROSPECTION_URL}/api/tenants/resume`,
      { tenant_id: uuid },
    );
    expect(
      resumeRes.ok(),
      `resume failed: ${resumeRes.status()} ${await resumeRes.text()}`,
    ).toBeTruthy();

    const healthFinalRes = await hubGet(
      request,
      `${PROSPECTION_URL}/api/tenants/${encodeURIComponent(tenant.tenantRef)}/health`,
    );
    const healthFinal = (await healthFinalRes.json()) as { status?: string };
    expect(healthFinal.status).toBe("active");
  });

  test("health sur tenant inconnu → 200 status=deleted (déterministe)", async ({
    request,
  }) => {
    // Le contrat §5.5 dit : tenant introuvable = même forme "deleted",
    // jamais 404, pour ne pas casser le cron Hub.
    const res = await hubGet(
      request,
      `${PROSPECTION_URL}/api/tenants/no-such-${Date.now()}@example.com/health`,
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      owner_attached?: boolean;
      magic_link_capable?: boolean;
    };
    expect(body.status).toBe("deleted");
    expect(body.owner_attached).toBe(false);
    expect(body.magic_link_capable).toBe(false);
  });
});
