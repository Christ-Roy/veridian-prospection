/**
 * Tests POST /api/tenants/{id}/purge — contrat §5.8.3.
 *
 * ⚠️ Endpoint IRRÉVERSIBLE. Tests stricts sur tous les garde-fous.
 *
 * Couvre les 5 garde-fous (chacun teste indépendamment) :
 *  1. Auth HMAC strict (401 sur chaque cas)
 *  2. confirm_slug requis + doit matcher slug
 *  3. reason requis + min 3 chars (audit GDPR)
 *  4. tenant doit être soft_deleted
 *  5. purgeEligibleAt doit être dans le passé
 *  6. Pas déjà purged (idempotence inverse)
 *
 * Plus :
 *  - 200 happy path : transaction Prisma s'exécute, status='deleted',
 *    purgedAt set, PII nulled, slug suffixé pour éviter collision,
 *    rows_deleted retourné par table, webhook tenant.purged (§7.1 v1.4) émis
 *  - T13 : 200 lookup par email owner (tenant_id = email legacy Hub)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-purge-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  tenantFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  txOutreachDelete: vi.fn(),
  txOutreachEmailDelete: vi.fn(),
  txCallLogDelete: vi.fn(),
  txClaudeActivityDelete: vi.fn(),
  txFollowupDelete: vi.fn(),
  txAppointmentDelete: vi.fn(),
  txPlanHistoryDelete: vi.fn(),
  txWorkspaceDelete: vi.fn(),
  txTenantUpdate: vi.fn(),
  prismaTransaction: vi.fn(),
  emitWebhook: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findUnique: mocks.tenantFindUnique,
      findFirst: mocks.tenantFindFirst,
    },
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.prismaTransaction,
  },
}));

vi.mock("@/lib/hub/webhooks", () => ({
  emitHubWebhookAsync: mocks.emitWebhook,
}));

import { POST } from "@/app/api/tenants/[id]/purge/route";
import { makeRequest, readJson } from "../../_helpers";

const SECRET = "test-purge-secret";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID_MISSING = "99999999-9999-4999-8999-999999999999";

function signed(body: object) {
  const raw = JSON.stringify(body);
  const ts = Date.now();
  const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  return {
    raw,
    headers: {
      "x-veridian-timestamp": String(ts),
      "x-veridian-hub-signature": sig,
    },
  };
}

function req(tenantId: string, raw: string, headers: Record<string, string>) {
  return makeRequest(`/api/tenants/${tenantId}/purge`, {
    method: "POST",
    headers,
    body: raw,
  });
}

function setupTxMock(rowCounts: Record<string, number> = {}) {
  mocks.prismaTransaction.mockImplementationOnce(async (cb) => {
    const tx = {
      outreach: { deleteMany: vi.fn().mockResolvedValue({ count: rowCounts.outreach ?? 0 }) },
      callLog: { deleteMany: vi.fn().mockResolvedValue({ count: rowCounts.call_log ?? 0 }) },
      claudeActivity: { deleteMany: vi.fn().mockResolvedValue({ count: rowCounts.claude_activity ?? 0 }) },
      followup: { deleteMany: vi.fn().mockResolvedValue({ count: rowCounts.followups ?? 0 }) },
      appointment: { deleteMany: vi.fn().mockResolvedValue({ count: rowCounts.appointments ?? 0 }) },
      planHistory: { deleteMany: vi.fn().mockResolvedValue({ count: rowCounts.plan_history ?? 0 }) },
      workspace: { deleteMany: vi.fn().mockResolvedValue({ count: rowCounts.workspaces ?? 0 }) },
      tenant: { update: mocks.txTenantUpdate.mockResolvedValueOnce({}) },
    };
    return cb(tx);
  });
}

const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // hier
const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // demain

describe("POST /api/tenants/{id}/purge — IRRÉVERSIBLE", () => {
  beforeEach(() => vi.clearAllMocks());

  // ───────── Auth ─────────

  test("401 Unauthorized si HMAC absent — pas de hit DB", async () => {
    const r = makeRequest(`/api/tenants/${TENANT_ID}/purge`, {
      method: "POST",
      body: { confirm_slug: "test", reason: "audit GDPR" },
    });
    const res = await POST(r, { params: Promise.resolve({ id: TENANT_ID }) });
    expect(res.status).toBe(401);
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
    expect(mocks.prismaTransaction).not.toHaveBeenCalled();
  });

  test("401 Invalid signature si HMAC bidon", async () => {
    const raw = JSON.stringify({ confirm_slug: "test", reason: "audit GDPR" });
    const r = makeRequest(`/api/tenants/${TENANT_ID}/purge`, {
      method: "POST",
      headers: {
        "x-veridian-timestamp": String(Date.now()),
        "x-veridian-hub-signature": "00".repeat(32),
      },
      body: raw,
    });
    const res = await POST(r, { params: Promise.resolve({ id: TENANT_ID }) });
    expect(res.status).toBe(401);
    expect(mocks.prismaTransaction).not.toHaveBeenCalled();
  });

  // ───────── Validation payload (garde-fous opérateur) ─────────

  test("400 invalid_payload si confirm_slug absent — pas de hit DB", async () => {
    const { raw, headers } = signed({ reason: "GDPR audit" });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string; message: string };
    expect(body.error).toBe("invalid_payload");
    expect(body.message).toContain("confirm_slug");
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("400 invalid_payload si reason absent — pas de hit DB", async () => {
    const { raw, headers } = signed({ confirm_slug: "test" });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string; message: string };
    expect(body.error).toBe("invalid_payload");
    expect(body.message).toContain("reason");
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("400 invalid_payload si reason < 3 chars (anti-bullshit GDPR)", async () => {
    const { raw, headers } = signed({ confirm_slug: "test", reason: "ok" });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(400);
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("400 invalid_payload si confirm_slug ne matche pas tenant.slug", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      slug: "real-slug",
      deletedAt: pastDate,
      purgeEligibleAt: pastDate,
      purgedAt: null,
    });
    const { raw, headers } = signed({
      confirm_slug: "wrong-slug",
      reason: "GDPR audit",
    });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string; message: string };
    expect(body.error).toBe("invalid_payload");
    expect(body.message).toContain("slug");
    // Critique : la DB n'est PAS touchée
    expect(mocks.prismaTransaction).not.toHaveBeenCalled();
  });

  // ───────── Lookup ─────────

  test("404 tenant_not_found", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    const { raw, headers } = signed({
      confirm_slug: "test",
      reason: "GDPR audit",
    });
    const res = await POST(req(TENANT_ID_MISSING, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID_MISSING }),
    });
    expect(res.status).toBe(404);
    expect(mocks.prismaTransaction).not.toHaveBeenCalled();
  });

  // ───────── Transitions illégales ─────────

  test("409 transition_illegal si tenant déjà purged", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      slug: "test",
      deletedAt: new Date("2026-01-01"),
      purgeEligibleAt: new Date("2026-04-01"),
      purgedAt: new Date("2026-04-15"),
    });
    const { raw, headers } = signed({
      confirm_slug: "test",
      reason: "GDPR audit",
    });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("transition_illegal");
    expect(mocks.prismaTransaction).not.toHaveBeenCalled();
  });

  test("409 tenant_not_purge_eligible si tenant pas soft_deleted", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      slug: "test",
      deletedAt: null,
      purgeEligibleAt: null,
      purgedAt: null,
    });
    const { raw, headers } = signed({
      confirm_slug: "test",
      reason: "GDPR audit",
    });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("tenant_not_purge_eligible");
    expect(mocks.prismaTransaction).not.toHaveBeenCalled();
  });

  test("409 tenant_not_purge_eligible si purgeEligibleAt dans le futur", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      slug: "test",
      deletedAt: pastDate,
      purgeEligibleAt: futureDate, // <-- futur
      purgedAt: null,
    });
    const { raw, headers } = signed({
      confirm_slug: "test",
      reason: "GDPR audit",
    });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(409);
    const body = (await readJson(res)) as {
      error: string;
      details: { purge_eligible_at: string };
    };
    expect(body.error).toBe("tenant_not_purge_eligible");
    expect(body.details.purge_eligible_at).toBe(futureDate.toISOString());
    expect(mocks.prismaTransaction).not.toHaveBeenCalled();
  });

  // ───────── Happy path ─────────

  test("200 purge complet : transaction OK, status=deleted, PII nulled, slug suffixé, webhook émis", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      id: TENANT_ID,
      userId: "owner-uid",
      slug: "client-acme",
      deletedAt: pastDate,
      purgeEligibleAt: pastDate,
      purgedAt: null,
    });
    setupTxMock({
      outreach: 42,
      call_log: 8,
      claude_activity: 100,
      followups: 5,
      appointments: 3,
      plan_history: 4,
      workspaces: 2,
    });
    const { raw, headers } = signed({
      confirm_slug: "client-acme",
      reason: "GDPR client erasure request 2026-05-19",
    });
    const res = await POST(req(TENANT_ID, raw, headers), {
      params: Promise.resolve({ id: TENANT_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      tenant_id: string;
      purged_at: string;
      rows_deleted: Record<string, number>;
    };
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.purged_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.rows_deleted).toEqual({
      outreach: 42,
      call_log: 8,
      claude_activity: 100,
      followups: 5,
      appointments: 3,
      plan_history: 4,
      workspaces: 2,
    });

    // Transaction Prisma a bien tourné
    expect(mocks.prismaTransaction).toHaveBeenCalledOnce();

    // Update tenant avec PII nullées, status=deleted, slug suffixé
    expect(mocks.txTenantUpdate).toHaveBeenCalledOnce();
    const updateCall = mocks.txTenantUpdate.mock.calls[0][0];
    expect(updateCall.where.id).toBe(TENANT_ID);
    expect(updateCall.data.status).toBe("deleted");
    expect(updateCall.data.purgedAt).toBeInstanceOf(Date);
    expect(updateCall.data.name).toBe("[purged]");
    expect(updateCall.data.slug).toMatch(/^client-acme-purged-\d+$/);
    expect(updateCall.data.twentyApiKey).toBeNull();
    expect(updateCall.data.notifuseApiKey).toBeNull();
    expect(updateCall.data.plan).toBeNull();
    expect(updateCall.data.planSource).toBeNull();
    expect(updateCall.data.metadata.purgeReason).toBe(
      "GDPR client erasure request 2026-05-19",
    );

    // §7.1 v1.4 — event spécifique tenant.purged (≠ tenant.deleted générique).
    // Le Hub matérialise prospection_purged_at + prospection_purged_rows.
    expect(mocks.emitWebhook).toHaveBeenCalledOnce();
    const [event, id, data] = mocks.emitWebhook.mock.calls[0];
    expect(event).toBe("tenant.purged");
    expect(id).toBe(TENANT_ID);
    expect(data.rows_deleted).toEqual(body.rows_deleted);
    expect(data.reason).toBe("GDPR client erasure request 2026-05-19");
    expect(data.purged_at).toBeDefined();
  });

  // ───────── T13 : lookup par email owner ─────────

  test("T13 — 200 purge avec lookup par email owner (tenant_id = email legacy)", async () => {
    // Le Hub legacy peut envoyer `tenant_id: owner@example.com` (provision).
    mocks.userFindUnique.mockResolvedValueOnce({ id: "owner-uid" });
    mocks.tenantFindFirst.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: "owner-uid",
    });
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: TENANT_ID,
      userId: "owner-uid",
      slug: "client-acme",
      deletedAt: pastDate,
      purgeEligibleAt: pastDate,
      purgedAt: null,
    });
    setupTxMock({ outreach: 1 });
    const { raw, headers } = signed({
      confirm_slug: "client-acme",
      reason: "GDPR via Hub legacy by email",
    });
    const res = await POST(req("owner@example.com", raw, headers), {
      params: Promise.resolve({ id: "owner@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { tenant_id: string };
    // Response = UUID résolu, PAS l'email reçu.
    expect(body.tenant_id).toBe(TENANT_ID);
    // L'update transactionnel utilise l'UUID résolu.
    expect(mocks.txTenantUpdate.mock.calls[0][0].where.id).toBe(TENANT_ID);
  });
});
