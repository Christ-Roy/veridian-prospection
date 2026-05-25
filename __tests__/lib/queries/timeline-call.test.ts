/**
 * Tests unitaires Phase 3 — appels Telnyx (call_log) dans la timeline 360°.
 *
 * Verrouille :
 *   - filtre tenant + workspace + siren (RBAC strict)
 *   - merge + tri desc avec autres sources
 *   - shape exposée (direction, status, durationSeconds, recordingPath, provider)
 *   - id Int → String côté event
 *   - inbound vs outbound distingués
 *   - recordingPath NULL → champ recordingPath: null (anti-faux-bouton "Écouter")
 *   - types ['call'] n'interroge QUE callLog
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  transitionFindMany: vi.fn(),
  followupFindMany: vi.fn(),
  appointmentFindMany: vi.fn(),
  leadEmailFindMany: vi.fn(),
  callLogFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipelineTransition: { findMany: mocks.transitionFindMany },
    followup: { findMany: mocks.followupFindMany },
    appointment: { findMany: mocks.appointmentFindMany },
    leadEmail: { findMany: mocks.leadEmailFindMany },
    callLog: { findMany: mocks.callLogFindMany },
  },
}));

import { getProspectTimeline } from "@/lib/queries/timeline";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transitionFindMany.mockResolvedValue([]);
  mocks.followupFindMany.mockResolvedValue([]);
  mocks.appointmentFindMany.mockResolvedValue([]);
  mocks.leadEmailFindMany.mockResolvedValue([]);
  mocks.callLogFindMany.mockResolvedValue([]);
});

describe("timeline call — RBAC + filtres", () => {
  test("filtre Prisma strict tenantId + siren", async () => {
    await getProspectTimeline({ siren: "123456789", tenantId: "tenant-A" });
    expect(mocks.callLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-A",
          siren: "123456789",
        }),
      }),
    );
  });

  test("workspaceFilter [] → sentinel '__none__' aussi sur callLog", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      workspaceFilter: [],
    });
    const args = mocks.callLogFindMany.mock.calls[0]![0];
    expect(args.where.workspaceId).toEqual({ in: ["__none__"] });
  });

  test("workspaceFilter [ids] restreint correctement", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      workspaceFilter: ["ws-1"],
    });
    const args = mocks.callLogFindMany.mock.calls[0]![0];
    expect(args.where.workspaceId).toEqual({ in: ["ws-1"] });
  });

  test("types ['call'] interroge UNIQUEMENT callLog", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["call"],
    });
    expect(mocks.callLogFindMany).toHaveBeenCalled();
    expect(mocks.leadEmailFindMany).not.toHaveBeenCalled();
    expect(mocks.transitionFindMany).not.toHaveBeenCalled();
    expect(mocks.followupFindMany).not.toHaveBeenCalled();
    expect(mocks.appointmentFindMany).not.toHaveBeenCalled();
  });

  test("orderBy startedAt desc côté Prisma", async () => {
    await getProspectTimeline({ siren: "123456789", tenantId: "t-1" });
    const args = mocks.callLogFindMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual({ startedAt: "desc" });
  });
});

describe("timeline call — normalisation event", () => {
  test("shape call outbound complète avec recording", async () => {
    mocks.callLogFindMany.mockResolvedValue([
      {
        id: 42,
        tenantId: "t-1",
        workspaceId: "ws-1",
        userId: "u-1",
        direction: "outbound",
        provider: "telnyx",
        fromNumber: "+33123456789",
        toNumber: "+33987654321",
        siren: "123456789",
        status: "completed",
        startedAt: "2026-05-24T10:00:00.000Z",
        endedAt: "2026-05-24T10:03:15.000Z",
        durationSeconds: 195,
        recordingPath: "/storage/recordings/42.mp3",
        notes: "Client intéressé",
        telnyxCallControlId: "tnx-xyz",
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["call"],
    });
    expect(evt).toMatchObject({
      type: "call",
      id: "42",
      occurredAt: "2026-05-24T10:00:00.000Z",
      direction: "outbound",
      status: "completed",
      durationSeconds: 195,
      recordingPath: "/storage/recordings/42.mp3",
      notes: "Client intéressé",
      provider: "telnyx",
    });
  });

  test("recordingPath NULL préservé (UI doit cacher bouton)", async () => {
    mocks.callLogFindMany.mockResolvedValue([
      {
        id: 7,
        direction: "inbound",
        provider: "telnyx",
        siren: "123456789",
        status: "missed",
        startedAt: "2026-05-24T08:00:00.000Z",
        endedAt: null,
        durationSeconds: 0,
        recordingPath: null,
        notes: null,
        telnyxCallControlId: "tnx-2",
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["call"],
    });
    expect((evt as { recordingPath: string | null }).recordingPath).toBeNull();
    expect((evt as { direction: string }).direction).toBe("inbound");
  });

  test("durationSeconds null toléré (appel non terminé / failed)", async () => {
    mocks.callLogFindMany.mockResolvedValue([
      {
        id: 99,
        direction: "outbound",
        provider: "telnyx",
        siren: "123456789",
        status: "failed",
        startedAt: "2026-05-24T11:00:00.000Z",
        endedAt: null,
        durationSeconds: null,
        recordingPath: null,
        notes: null,
        telnyxCallControlId: null,
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["call"],
    });
    expect((evt as { durationSeconds: number | null }).durationSeconds).toBeNull();
  });

  test("id Int → String (sérialisation cohérente avec followup)", async () => {
    mocks.callLogFindMany.mockResolvedValue([
      {
        id: 1234567,
        direction: "outbound",
        provider: "telnyx",
        siren: "123456789",
        status: "completed",
        startedAt: "2026-05-24T11:00:00.000Z",
        endedAt: "2026-05-24T11:01:00.000Z",
        durationSeconds: 60,
        recordingPath: null,
        notes: null,
        telnyxCallControlId: null,
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["call"],
    });
    expect(evt.id).toBe("1234567");
    expect(typeof evt.id).toBe("string");
  });
});

describe("timeline call — merge multi-source + tri desc", () => {
  test("call + mail_out + appointment merged et triés desc", async () => {
    mocks.appointmentFindMany.mockResolvedValue([
      {
        id: "appt-1",
        startAt: new Date("2026-05-22T16:00:00Z"),
        title: "Demo",
        status: "scheduled",
        notes: null,
        sourceStage: null,
      },
    ]);
    mocks.callLogFindMany.mockResolvedValue([
      {
        id: 1,
        direction: "outbound",
        provider: "telnyx",
        siren: "123456789",
        status: "completed",
        startedAt: "2026-05-25T09:00:00.000Z",
        endedAt: "2026-05-25T09:02:00.000Z",
        durationSeconds: 120,
        recordingPath: null,
        notes: null,
        telnyxCallControlId: null,
      },
    ]);
    mocks.leadEmailFindMany.mockResolvedValue([
      {
        id: "mail-1",
        direction: "outgoing",
        subject: "Suite démo",
        bodyText: "x",
        bodyHtml: null,
        templateSlug: null,
        fromEmail: "a@a",
        toEmails: ["b@b"],
        ccEmails: [],
        sentStatus: "sent",
        sentAt: new Date("2026-05-23T14:00:00Z"),
        createdAt: new Date("2026-05-23T14:00:00Z"),
      },
    ]);

    const events = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
    });
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("call");
    expect(events[1].type).toBe("mail_out");
    expect(events[2].type).toBe("appointment");
  });

  test("filtre since post-merge écarte un appel trop ancien", async () => {
    mocks.callLogFindMany.mockResolvedValue([
      {
        id: 1,
        direction: "outbound",
        provider: "telnyx",
        siren: "123456789",
        status: "completed",
        startedAt: "2026-05-10T10:00:00.000Z",
        endedAt: "2026-05-10T10:01:00.000Z",
        durationSeconds: 60,
        recordingPath: null,
        notes: null,
        telnyxCallControlId: null,
      },
      {
        id: 2,
        direction: "outbound",
        provider: "telnyx",
        siren: "123456789",
        status: "completed",
        startedAt: "2026-05-25T10:00:00.000Z",
        endedAt: "2026-05-25T10:01:00.000Z",
        durationSeconds: 60,
        recordingPath: null,
        notes: null,
        telnyxCallControlId: null,
      },
    ]);
    const events = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      since: "2026-05-20T00:00:00Z",
      types: ["call"],
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { id: string }).id).toBe("2");
  });

  test("limit cap appliqué après merge (3 calls, limit 2)", async () => {
    mocks.callLogFindMany.mockResolvedValue([
      {
        id: 1,
        direction: "outbound",
        provider: "telnyx",
        siren: "123456789",
        status: "completed",
        startedAt: "2026-05-25T10:00:00.000Z",
        endedAt: "2026-05-25T10:01:00.000Z",
        durationSeconds: 60,
        recordingPath: null,
        notes: null,
        telnyxCallControlId: null,
      },
      {
        id: 2,
        direction: "outbound",
        provider: "telnyx",
        siren: "123456789",
        status: "completed",
        startedAt: "2026-05-24T10:00:00.000Z",
        endedAt: "2026-05-24T10:01:00.000Z",
        durationSeconds: 60,
        recordingPath: null,
        notes: null,
        telnyxCallControlId: null,
      },
      {
        id: 3,
        direction: "outbound",
        provider: "telnyx",
        siren: "123456789",
        status: "completed",
        startedAt: "2026-05-23T10:00:00.000Z",
        endedAt: "2026-05-23T10:01:00.000Z",
        durationSeconds: 60,
        recordingPath: null,
        notes: null,
        telnyxCallControlId: null,
      },
    ]);
    const events = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["call"],
      limit: 2,
    });
    expect(events).toHaveLength(2);
    expect((events[0] as { id: string }).id).toBe("1");
    expect((events[1] as { id: string }).id).toBe("2");
  });
});
