/**
 * Tests unitaires Phase 2 — mails sortants dans la timeline 360°.
 *
 * Verrouille :
 *   - filtre direction='outgoing' strict (les entrants W8b ne fuitent pas)
 *   - filtre tenant + workspace (RBAC)
 *   - merge + tri desc avec les autres sources
 *   - fallback occurredAt = createdAt si sentAt null
 *   - body preview généré depuis bodyText (fallback bodyHtml stripped)
 *   - body preview tronqué à 220 chars + ellipse
 *   - filtre types ['mail_out'] n'interroge QUE leadEmail
 *
 * Sabotage-test mental : si on retire le filtre direction='outgoing', un mail
 * entrant (livré par W8b plus tard) leakerait dans mailsOut → un test ici
 * vérifie explicitement que la where clause contient direction.
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

describe("timeline mail_out — RBAC + filtres", () => {
  test("filtre Prisma direction='outgoing' explicite (anti leak Phase 2.5)", async () => {
    await getProspectTimeline({ siren: "123456789", tenantId: "t-1" });
    expect(mocks.leadEmailFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          direction: "outgoing",
          tenantId: "t-1",
          siren: "123456789",
        }),
      }),
    );
  });

  test("workspaceFilter [ids] restreint le findMany lead_emails", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      workspaceFilter: ["ws-1", "ws-2"],
    });
    const args = mocks.leadEmailFindMany.mock.calls[0]![0];
    expect(args.where.workspaceId).toEqual({ in: ["ws-1", "ws-2"] });
  });

  test("workspaceFilter [] → sentinel '__none__'", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      workspaceFilter: [],
    });
    const args = mocks.leadEmailFindMany.mock.calls[0]![0];
    expect(args.where.workspaceId).toEqual({ in: ["__none__"] });
  });

  test("workspaceFilter null → aucun filtre workspaceId", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      workspaceFilter: null,
    });
    const args = mocks.leadEmailFindMany.mock.calls[0]![0];
    expect(args.where.workspaceId).toBeUndefined();
  });

  test("types === ['mail_out'] interroge UNIQUEMENT leadEmail (pas call, pas transition, etc.)", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["mail_out"],
    });
    expect(mocks.leadEmailFindMany).toHaveBeenCalled();
    expect(mocks.transitionFindMany).not.toHaveBeenCalled();
    expect(mocks.followupFindMany).not.toHaveBeenCalled();
    expect(mocks.appointmentFindMany).not.toHaveBeenCalled();
    expect(mocks.callLogFindMany).not.toHaveBeenCalled();
  });

  test("types === ['call'] ne fait PAS de findMany leadEmail (pas de cross-leak)", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["call"],
    });
    expect(mocks.leadEmailFindMany).not.toHaveBeenCalled();
  });

  test("types === [] → AUCUNE source y compris leadEmail", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: [],
    });
    expect(mocks.leadEmailFindMany).not.toHaveBeenCalled();
  });

  test("orderBy sentAt desc côté Prisma", async () => {
    await getProspectTimeline({ siren: "123456789", tenantId: "t-1" });
    const args = mocks.leadEmailFindMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual({ sentAt: "desc" });
  });
});

describe("timeline mail_out — normalisation event", () => {
  test("shape mail_out — subject + bodyPreview depuis bodyText + sentAt → occurredAt ISO", async () => {
    mocks.leadEmailFindMany.mockResolvedValue([
      {
        id: "mail-uuid-1",
        siren: "123456789",
        tenantId: "t-1",
        workspaceId: "ws-1",
        direction: "outgoing",
        subject: "Bonjour Robert — démo Veridian",
        bodyText: "Bonjour,\nJe vous propose une démo demain à 14h. Cordialement.",
        bodyHtml: null,
        templateSlug: "cold-intro-v3",
        fromEmail: "robert@veridian.site",
        toEmails: ["client@example.com"],
        ccEmails: [],
        sentStatus: "sent",
        sentAt: new Date("2026-05-24T09:30:00Z"),
        createdAt: new Date("2026-05-24T09:29:00Z"),
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["mail_out"],
    });
    expect(evt).toMatchObject({
      type: "mail_out",
      id: "mail-uuid-1",
      occurredAt: "2026-05-24T09:30:00.000Z",
      subject: "Bonjour Robert — démo Veridian",
      templateSlug: "cold-intro-v3",
      fromEmail: "robert@veridian.site",
      toEmails: ["client@example.com"],
      status: "sent",
    });
    // body preview = bodyText nettoyé (newlines → space), pas tronqué (< 220 chars)
    expect((evt as { bodyPreview: string }).bodyPreview).toContain("démo demain");
    expect((evt as { bodyPreview: string }).bodyPreview).not.toContain("\n");
  });

  test("fallback occurredAt = createdAt si sentAt NULL (queued/failed)", async () => {
    mocks.leadEmailFindMany.mockResolvedValue([
      {
        id: "mail-failed",
        siren: "123456789",
        tenantId: "t-1",
        workspaceId: "ws-1",
        direction: "outgoing",
        subject: "Failed",
        bodyText: "x",
        bodyHtml: null,
        templateSlug: null,
        fromEmail: "robert@veridian.site",
        toEmails: ["a@b.com"],
        ccEmails: [],
        sentStatus: "failed",
        sentAt: null,
        createdAt: new Date("2026-05-23T08:00:00Z"),
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["mail_out"],
    });
    expect(evt.occurredAt).toBe("2026-05-23T08:00:00.000Z");
  });

  test("bodyPreview fallback bodyHtml stripped si bodyText NULL", async () => {
    mocks.leadEmailFindMany.mockResolvedValue([
      {
        id: "mail-html",
        siren: "123456789",
        tenantId: "t-1",
        workspaceId: "ws-1",
        direction: "outgoing",
        subject: "Html only",
        bodyText: null,
        bodyHtml: "<p>Bonjour <strong>Robert</strong>,</p><p>Voici ma démo.</p>",
        templateSlug: null,
        fromEmail: "robert@veridian.site",
        toEmails: ["a@b.com"],
        ccEmails: [],
        sentStatus: "sent",
        sentAt: new Date("2026-05-24T10:00:00Z"),
        createdAt: new Date("2026-05-24T10:00:00Z"),
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["mail_out"],
    });
    const preview = (evt as { bodyPreview: string }).bodyPreview;
    expect(preview).toContain("Bonjour Robert");
    expect(preview).not.toContain("<p>");
    expect(preview).not.toContain("<strong>");
  });

  test("bodyPreview tronqué à 220 chars + ellipse sur subject super long (pollution DB)", async () => {
    const longText = "x".repeat(1000);
    mocks.leadEmailFindMany.mockResolvedValue([
      {
        id: "mail-long",
        siren: "123456789",
        tenantId: "t-1",
        workspaceId: "ws-1",
        direction: "outgoing",
        subject: "S",
        bodyText: longText,
        bodyHtml: null,
        templateSlug: null,
        fromEmail: "robert@veridian.site",
        toEmails: ["a@b.com"],
        ccEmails: [],
        sentStatus: "sent",
        sentAt: new Date("2026-05-24T10:00:00Z"),
        createdAt: new Date("2026-05-24T10:00:00Z"),
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["mail_out"],
    });
    const preview = (evt as { bodyPreview: string }).bodyPreview;
    // 220 chars + "…" (1 codepoint)
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(221);
  });

  test("bodyPreview NULL si bodyText et bodyHtml tous NULL (edge case)", async () => {
    mocks.leadEmailFindMany.mockResolvedValue([
      {
        id: "mail-empty",
        siren: "123456789",
        tenantId: "t-1",
        workspaceId: "ws-1",
        direction: "outgoing",
        subject: "Pas de body",
        bodyText: null,
        bodyHtml: null,
        templateSlug: null,
        fromEmail: "robert@veridian.site",
        toEmails: ["a@b.com"],
        ccEmails: [],
        sentStatus: "sent",
        sentAt: new Date("2026-05-24T10:00:00Z"),
        createdAt: new Date("2026-05-24T10:00:00Z"),
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["mail_out"],
    });
    expect((evt as { bodyPreview: string | null }).bodyPreview).toBeNull();
  });
});

describe("timeline mail_out — merge multi-source", () => {
  test("merge mail_out + transition + appointment trie desc par occurredAt", async () => {
    mocks.transitionFindMany.mockResolvedValue([
      {
        id: "tr-1",
        occurredAt: new Date("2026-05-20T10:00:00Z"),
        fromStage: "a_rappeler",
        toStage: "site_demo",
        userId: "u-1",
      },
    ]);
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
    mocks.leadEmailFindMany.mockResolvedValue([
      {
        id: "mail-1",
        direction: "outgoing",
        subject: "Suite à notre démo",
        bodyText: "x",
        bodyHtml: null,
        templateSlug: null,
        fromEmail: "a@a",
        toEmails: ["b@b"],
        ccEmails: [],
        sentStatus: "sent",
        sentAt: new Date("2026-05-24T09:00:00Z"),
        createdAt: new Date("2026-05-24T09:00:00Z"),
      },
    ]);

    const events = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
    });
    expect(events).toHaveLength(3);
    // 24 > 22 > 20
    expect(events[0].type).toBe("mail_out");
    expect(events[1].type).toBe("appointment");
    expect(events[2].type).toBe("pipeline_transition");
  });

  test("filtre since post-merge écarte un mail trop ancien", async () => {
    mocks.leadEmailFindMany.mockResolvedValue([
      {
        id: "old",
        direction: "outgoing",
        subject: "old",
        bodyText: "x",
        bodyHtml: null,
        templateSlug: null,
        fromEmail: "a@a",
        toEmails: ["b@b"],
        ccEmails: [],
        sentStatus: "sent",
        sentAt: new Date("2026-05-10T10:00:00Z"),
        createdAt: new Date("2026-05-10T10:00:00Z"),
      },
      {
        id: "new",
        direction: "outgoing",
        subject: "new",
        bodyText: "x",
        bodyHtml: null,
        templateSlug: null,
        fromEmail: "a@a",
        toEmails: ["b@b"],
        ccEmails: [],
        sentStatus: "sent",
        sentAt: new Date("2026-05-24T10:00:00Z"),
        createdAt: new Date("2026-05-24T10:00:00Z"),
      },
    ]);
    const events = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      since: "2026-05-15T00:00:00Z",
      types: ["mail_out"],
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { id: string }).id).toBe("new");
  });
});
