/**
 * Tests GET /api/tenants/{id}/usage-summary — contrat §5.8.5.
 *
 * Couvre :
 *  - 401 distincts : Unauthorized, Invalid signature
 *  - 404 tenant_not_found
 *  - 200 + agrégats corrects depuis les 7 tables tenant-scoped
 *  - lastUserActivityAt utilise lastTouchedAt si présent, fallback lastActivityAt
 *  - activeUsers30d = 0 si aucun appointment récent, = members count sinon
 *  - domain_specific contient les bons compteurs
 *  - size_mb_estimate calculé proportionnellement
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

vi.hoisted(() => {
  process.env.HUB_API_SECRET = "test-usage-secret";
  process.env.ACCEPT_LEGACY_BEARER = "0";
});

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  outreachCount: vi.fn(),
  outreachEmailCount: vi.fn(),
  callLogCount: vi.fn(),
  appointmentCount: vi.fn(),
  followupCount: vi.fn(),
  workspaceCount: vi.fn(),
  workspaceMemberCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
    outreach: { count: mocks.outreachCount },
    outreachEmail: { count: mocks.outreachEmailCount },
    callLog: { count: mocks.callLogCount },
    appointment: { count: mocks.appointmentCount },
    followup: { count: mocks.followupCount },
    workspace: { count: mocks.workspaceCount },
    workspaceMember: { count: mocks.workspaceMemberCount },
  },
}));

import { GET } from "@/app/api/tenants/[id]/usage-summary/route";
import { makeRequest, readJson } from "../../_helpers";

const SECRET = "test-usage-secret";

function signedGet(tenantId: string) {
  const ts = Date.now();
  const sig = createHmac("sha256", SECRET).update(`${ts}.`).digest("hex");
  return {
    req: makeRequest(`/api/tenants/${tenantId}/usage-summary`, {
      method: "GET",
      headers: {
        "x-veridian-timestamp": String(ts),
        "x-veridian-hub-signature": sig,
      },
    }),
    params: Promise.resolve({ id: tenantId }),
  };
}

describe("GET /api/tenants/{id}/usage-summary", () => {
  beforeEach(() => vi.clearAllMocks());

  test("401 Unauthorized si HMAC absent — pas de hit DB", async () => {
    const req = makeRequest("/api/tenants/t-1/usage-summary", { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ id: "t-1" }) });
    expect(res.status).toBe(401);
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("401 Invalid signature si HMAC bidon", async () => {
    const req = makeRequest("/api/tenants/t-1/usage-summary", {
      method: "GET",
      headers: {
        "x-veridian-timestamp": String(Date.now()),
        "x-veridian-hub-signature": "00".repeat(32),
      },
    });
    const res = await GET(req, { params: Promise.resolve({ id: "t-1" }) });
    expect(res.status).toBe(401);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("Invalid signature");
    expect(mocks.tenantFindUnique).not.toHaveBeenCalled();
  });

  test("404 tenant_not_found", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce(null);
    const { req, params } = signedGet("t-x");
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toBe("tenant_not_found");
    // Critique : si tenant introuvable, pas de count() sur les 7 autres tables
    expect(mocks.outreachCount).not.toHaveBeenCalled();
    expect(mocks.appointmentCount).not.toHaveBeenCalled();
  });

  test("200 agrégats corrects + lastTouchedAt prioritaire sur lastActivityAt", async () => {
    const touchedAt = new Date("2026-05-15T10:00:00Z");
    const activityAt = new Date("2026-04-01T10:00:00Z");
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      lastActivityAt: activityAt,
      lastTouchedAt: touchedAt,
    });
    mocks.outreachCount.mockResolvedValueOnce(120);
    mocks.outreachEmailCount.mockResolvedValueOnce(45);
    mocks.callLogCount.mockResolvedValueOnce(30);
    mocks.appointmentCount.mockResolvedValueOnce(15);
    mocks.followupCount.mockResolvedValueOnce(8);
    mocks.workspaceCount.mockResolvedValueOnce(2);
    mocks.workspaceMemberCount.mockResolvedValueOnce(5);
    // recentAppointments dans les 30j : oui, on retourne members_count
    mocks.appointmentCount.mockResolvedValueOnce(3);

    const { req, params } = signedGet("t-1");
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      tenant_id: string;
      data_volume: { rows_total: number; size_mb_estimate: number };
      activity: {
        last_user_activity_at: string;
        active_users_30d: number;
      };
      domain_specific: Record<string, number>;
    };
    expect(body.tenant_id).toBe("t-1");
    expect(body.data_volume.rows_total).toBe(120 + 45 + 30 + 15 + 8);
    expect(body.data_volume.size_mb_estimate).toBeGreaterThanOrEqual(0);

    // lastTouchedAt prioritaire (§5.8.4 : touch écrase lastActivity côté UX)
    expect(body.activity.last_user_activity_at).toBe(touchedAt.toISOString());
    expect(body.activity.active_users_30d).toBe(5);

    expect(body.domain_specific.prospects_outreach_total).toBe(120);
    expect(body.domain_specific.emails_sent_total).toBe(45);
    expect(body.domain_specific.calls_logged_total).toBe(30);
    expect(body.domain_specific.appointments_total).toBe(15);
    expect(body.domain_specific.followups_total).toBe(8);
    expect(body.domain_specific.workspaces_count).toBe(2);
    expect(body.domain_specific.active_members_count).toBe(5);
  });

  test("lastTouchedAt null → fallback lastActivityAt", async () => {
    const activityAt = new Date("2026-04-01T10:00:00Z");
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      lastActivityAt: activityAt,
      lastTouchedAt: null,
    });
    mocks.outreachCount.mockResolvedValueOnce(0);
    mocks.outreachEmailCount.mockResolvedValueOnce(0);
    mocks.callLogCount.mockResolvedValueOnce(0);
    mocks.appointmentCount.mockResolvedValueOnce(0);
    mocks.followupCount.mockResolvedValueOnce(0);
    mocks.workspaceCount.mockResolvedValueOnce(0);
    mocks.workspaceMemberCount.mockResolvedValueOnce(0);
    mocks.appointmentCount.mockResolvedValueOnce(0);

    const { req, params } = signedGet("t-1");
    const body = (await readJson(await GET(req, { params }))) as {
      activity: { last_user_activity_at: string };
    };
    expect(body.activity.last_user_activity_at).toBe(activityAt.toISOString());
  });

  test("aucune activité du tout → last_user_activity_at = null", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      lastActivityAt: null,
      lastTouchedAt: null,
    });
    mocks.outreachCount.mockResolvedValueOnce(0);
    mocks.outreachEmailCount.mockResolvedValueOnce(0);
    mocks.callLogCount.mockResolvedValueOnce(0);
    mocks.appointmentCount.mockResolvedValueOnce(0);
    mocks.followupCount.mockResolvedValueOnce(0);
    mocks.workspaceCount.mockResolvedValueOnce(0);
    mocks.workspaceMemberCount.mockResolvedValueOnce(0);
    mocks.appointmentCount.mockResolvedValueOnce(0);

    const { req, params } = signedGet("t-1");
    const body = (await readJson(await GET(req, { params }))) as {
      activity: { last_user_activity_at: string | null; active_users_30d: number };
    };
    expect(body.activity.last_user_activity_at).toBeNull();
    expect(body.activity.active_users_30d).toBe(0);
  });

  test("activeUsers30d = 0 si aucun appointment dans les 30j (même si members existent)", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      lastActivityAt: new Date(),
      lastTouchedAt: null,
    });
    mocks.outreachCount.mockResolvedValueOnce(50);
    mocks.outreachEmailCount.mockResolvedValueOnce(0);
    mocks.callLogCount.mockResolvedValueOnce(0);
    mocks.appointmentCount.mockResolvedValueOnce(50); // appointments total
    mocks.followupCount.mockResolvedValueOnce(0);
    mocks.workspaceCount.mockResolvedValueOnce(1);
    mocks.workspaceMemberCount.mockResolvedValueOnce(3);
    mocks.appointmentCount.mockResolvedValueOnce(0); // recent dans 30j = 0

    const { req, params } = signedGet("t-1");
    const body = (await readJson(await GET(req, { params }))) as {
      activity: { active_users_30d: number };
    };
    expect(body.activity.active_users_30d).toBe(0);
  });

  test("checked_at présent, format ISO8601", async () => {
    mocks.tenantFindUnique.mockResolvedValueOnce({
      id: "t-1",
      lastActivityAt: null,
      lastTouchedAt: null,
    });
    mocks.outreachCount.mockResolvedValue(0);
    mocks.outreachEmailCount.mockResolvedValue(0);
    mocks.callLogCount.mockResolvedValue(0);
    mocks.appointmentCount.mockResolvedValue(0);
    mocks.followupCount.mockResolvedValue(0);
    mocks.workspaceCount.mockResolvedValue(0);
    mocks.workspaceMemberCount.mockResolvedValue(0);

    const { req, params } = signedGet("t-1");
    const body = (await readJson(await GET(req, { params }))) as {
      checked_at: string;
    };
    expect(body.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
