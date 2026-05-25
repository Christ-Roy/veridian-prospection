/**
 * Tests GET /api/leads/[siren]/timeline — fiche historique prospect 360° Phase 1.
 *
 * Sécurité testée :
 *   - 401 sans auth (requireUser)
 *   - 400 si SIREN malformé
 *   - filtre tenantId strict (pas de cross-tenant)
 *   - filtre workspaceFilter respecté (RBAC scope "own")
 *   - filtre types CSV + since/until
 *
 * Source-level testée :
 *   - merge multi-source + tri descending occurredAt
 *   - hook recordPipelineTransition n'écrit RIEN si stage inchangé
 *   - hook insert correctement si stage change
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireUserMock, getWorkspaceScopeMock, prismaMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  prismaMock: {
    pipelineTransition: { findMany: vi.fn(), create: vi.fn() },
    followup: { findMany: vi.fn() },
    appointment: { findMany: vi.fn() },
    leadEmail: { findMany: vi.fn() },
    callLog: { findMany: vi.fn() },
    outreach: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth/user-context", () => ({
  requireUser: requireUserMock,
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { GET } from "@/app/api/leads/[domain]/timeline/route";
import { makeRequest, makeUserContext } from "../../_helpers";

function callGet(siren: string, query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  const url = `/api/leads/${siren}/timeline${qs ? `?${qs}` : ""}`;
  return GET(makeRequest(url), {
    params: Promise.resolve({ domain: siren }),
  });
}

describe("GET /api/leads/[siren]/timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceScopeMock.mockResolvedValue({
      ctx: null,
      filter: null,
      insertId: null,
    });
    prismaMock.pipelineTransition.findMany.mockResolvedValue([]);
    prismaMock.followup.findMany.mockResolvedValue([]);
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.leadEmail.findMany.mockResolvedValue([]);
    prismaMock.callLog.findMany.mockResolvedValue([]);
  });

  test("401 si non authentifié", async () => {
    requireUserMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await callGet("123456789");
    expect(res.status).toBe(401);
  });

  test("400 si SIREN malformé (non-9-chiffres)", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    const res = await callGet("notanumber");
    expect(res.status).toBe(400);
  });

  test("400 si SIREN trop court", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    const res = await callGet("12345");
    expect(res.status).toBe(400);
  });

  test("filtre Prisma strictement par tenantId (RBAC)", async () => {
    requireUserMock.mockResolvedValue({
      ctx: makeUserContext({ tenantId: "tenant-A" }),
    });
    await callGet("123456789");
    expect(prismaMock.pipelineTransition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-A", siren: "123456789" }),
      }),
    );
    expect(prismaMock.followup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-A", siren: "123456789" }),
      }),
    );
    expect(prismaMock.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-A", siren: "123456789" }),
      }),
    );
  });

  test("user scope 'own' avec workspaceFilter restreint la requête", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext({ tenantId: "t-1" }) });
    getWorkspaceScopeMock.mockResolvedValue({
      ctx: null,
      filter: ["ws-1", "ws-2"],
      insertId: "ws-1",
    });
    await callGet("123456789");
    expect(prismaMock.pipelineTransition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: { in: ["ws-1", "ws-2"] },
        }),
      }),
    );
  });

  test("user sans workspace (filter []) ne voit aucun event", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    getWorkspaceScopeMock.mockResolvedValue({
      ctx: null,
      filter: [],
      insertId: null,
    });
    await callGet("123456789");
    // L'implémentation injecte un sentinel "__none__" qui ne matchera aucune row
    expect(prismaMock.pipelineTransition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: { in: ["__none__"] },
        }),
      }),
    );
  });

  test("merge multi-source + tri descending occurredAt", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext({ tenantId: "t-1" }) });

    prismaMock.pipelineTransition.findMany.mockResolvedValue([
      {
        id: "tr-1",
        occurredAt: new Date("2026-05-20T10:00:00Z"),
        fromStage: "a_rappeler",
        toStage: "site_demo",
        userId: "u-1",
      },
    ]);
    prismaMock.followup.findMany.mockResolvedValue([
      {
        id: 42,
        scheduledAt: "2026-05-23T14:00:00Z",
        status: "pending",
        note: "Relancer demain",
      },
    ]);
    prismaMock.appointment.findMany.mockResolvedValue([
      {
        id: "appt-1",
        startAt: new Date("2026-05-22T16:00:00Z"),
        title: "Demo Q3",
        status: "scheduled",
        notes: null,
        sourceStage: "site_demo",
      },
    ]);

    const res = await callGet("123456789");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ type: string; occurredAt: string }> };

    expect(body.events).toHaveLength(3);
    // Tri descending : 2026-05-23 > 2026-05-22 > 2026-05-20
    expect(body.events[0].type).toBe("followup");
    expect(body.events[1].type).toBe("appointment");
    expect(body.events[2].type).toBe("pipeline_transition");
  });

  test("filtre types CSV n'appelle que les sources demandées", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    await callGet("123456789", { types: "pipeline_transition" });
    expect(prismaMock.pipelineTransition.findMany).toHaveBeenCalled();
    expect(prismaMock.followup.findMany).not.toHaveBeenCalled();
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
    expect(prismaMock.leadEmail.findMany).not.toHaveBeenCalled();
    expect(prismaMock.callLog.findMany).not.toHaveBeenCalled();
  });

  test("whitelist ALLOW 'mail_out' (Phase 2)", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    await callGet("123456789", { types: "mail_out" });
    expect(prismaMock.leadEmail.findMany).toHaveBeenCalled();
    expect(prismaMock.pipelineTransition.findMany).not.toHaveBeenCalled();
    expect(prismaMock.callLog.findMany).not.toHaveBeenCalled();
  });

  test("whitelist ALLOW 'call' (Phase 3)", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    await callGet("123456789", { types: "call" });
    expect(prismaMock.callLog.findMany).toHaveBeenCalled();
    expect(prismaMock.leadEmail.findMany).not.toHaveBeenCalled();
    expect(prismaMock.pipelineTransition.findMany).not.toHaveBeenCalled();
  });

  test("whitelist REJECT type inconnu (mail_in pas encore exposé — Phase 2.5)", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    await callGet("123456789", { types: "mail_in" });
    // 'mail_in' filtré par whitelist → types devient []
    // → toutes les sources sont SKIP (semantique types==[])
    expect(prismaMock.pipelineTransition.findMany).not.toHaveBeenCalled();
    expect(prismaMock.followup.findMany).not.toHaveBeenCalled();
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
    expect(prismaMock.leadEmail.findMany).not.toHaveBeenCalled();
    expect(prismaMock.callLog.findMany).not.toHaveBeenCalled();
  });

  test("mail_out + call dans CSV → les 2 sources interrogées, pas les autres", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    await callGet("123456789", { types: "mail_out,call" });
    expect(prismaMock.leadEmail.findMany).toHaveBeenCalled();
    expect(prismaMock.callLog.findMany).toHaveBeenCalled();
    expect(prismaMock.pipelineTransition.findMany).not.toHaveBeenCalled();
    expect(prismaMock.followup.findMany).not.toHaveBeenCalled();
    expect(prismaMock.appointment.findMany).not.toHaveBeenCalled();
  });

  test("Cache-Control: private + max-age court", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    const res = await callGet("123456789");
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("private");
    expect(cc).toMatch(/max-age=\d+/);
  });

  test("limit clampé entre 1 et 500", async () => {
    requireUserMock.mockResolvedValue({ ctx: makeUserContext() });
    await callGet("123456789", { limit: "99999" });
    expect(prismaMock.pipelineTransition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
  });
});

// ============================================================================
// Hook recordPipelineTransition — couvert via patchOutreach (lib/queries/pipeline)
// ============================================================================

describe("hook pipeline_transitions — sabotage-test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("recordPipelineTransition ne crée RIEN si fromStage == toStage", async () => {
    // Le hook est exporté indirectement : on charge la fonction interne via
    // un import nommé conditionnel. Si à terme la signature change (le hook
    // est extrait dans un module dédié), ce test devra suivre.
    const { __testing } = await import("@/lib/queries/pipeline-internal-testing");
    const createSpy = vi.fn();
    await __testing.recordPipelineTransition(
      {
        siren: "123456789",
        tenantId: "t-1",
        workspaceId: null,
        userId: null,
        fromStage: "site_demo",
        toStage: "site_demo",
      },
      { create: createSpy } as never,
    );
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("recordPipelineTransition insère si stage change", async () => {
    const { __testing } = await import("@/lib/queries/pipeline-internal-testing");
    const createSpy = vi.fn().mockResolvedValue({});
    await __testing.recordPipelineTransition(
      {
        siren: "123456789",
        tenantId: "t-1",
        workspaceId: "ws-1",
        userId: "u-1",
        fromStage: "a_rappeler",
        toStage: "site_demo",
      },
      { create: createSpy } as never,
    );
    expect(createSpy).toHaveBeenCalledOnce();
    expect(createSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        siren: "123456789",
        tenantId: "t-1",
        workspaceId: "ws-1",
        userId: "u-1",
        fromStage: "a_rappeler",
        toStage: "site_demo",
      }),
    });
  });
});
