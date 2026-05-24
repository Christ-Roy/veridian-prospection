/**
 * Tests unitaires de src/lib/queries/timeline.ts — agrégation fil chronologique
 * fiche prospect 360° Phase 1.
 *
 * Couvre la logique pure du helper avec Prisma mocké :
 *  - validation SIREN (9 chiffres)
 *  - merge 3 sources (pipeline_transitions + followups + appointments)
 *  - tri descending par occurredAt (peu importe la source d'origine)
 *  - filtre tenant strict (jamais cross-tenant)
 *  - filtre workspace : null = pas de filtre, [] = aucun résultat, [...ids]
 *    = restrict
 *  - filtre types : undefined = tous, [] = aucun, [type] = ce type uniquement
 *  - filtre date since/until appliqué post-merge
 *  - limit final
 *
 * Les RBAC route + sabotage du hook recordPipelineTransition sont testés
 * séparément (__tests__/api/leads/[domain]/timeline.test.ts).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  transitionFindMany: vi.fn(),
  followupFindMany: vi.fn(),
  appointmentFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipelineTransition: { findMany: mocks.transitionFindMany },
    followup: { findMany: mocks.followupFindMany },
    appointment: { findMany: mocks.appointmentFindMany },
  },
}));

import { getProspectTimeline } from "@/lib/queries/timeline";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transitionFindMany.mockResolvedValue([]);
  mocks.followupFindMany.mockResolvedValue([]);
  mocks.appointmentFindMany.mockResolvedValue([]);
});

describe("getProspectTimeline — validation", () => {
  test("throw si SIREN malformé (non 9 chiffres)", async () => {
    await expect(
      getProspectTimeline({ siren: "notanumber", tenantId: "t-1" }),
    ).rejects.toThrow(/invalid SIREN/);
  });

  test("throw si SIREN trop court", async () => {
    await expect(
      getProspectTimeline({ siren: "12345", tenantId: "t-1" }),
    ).rejects.toThrow(/invalid SIREN/);
  });

  test("throw si SIREN avec lettres", async () => {
    await expect(
      getProspectTimeline({ siren: "12345678A", tenantId: "t-1" }),
    ).rejects.toThrow(/invalid SIREN/);
  });
});

describe("getProspectTimeline — filtre tenant strict (RBAC)", () => {
  test("passe tenantId à TOUTES les 3 sources Prisma", async () => {
    await getProspectTimeline({ siren: "123456789", tenantId: "tenant-A" });
    expect(mocks.transitionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-A", siren: "123456789" }),
      }),
    );
    expect(mocks.followupFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-A", siren: "123456789" }),
      }),
    );
    expect(mocks.appointmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-A", siren: "123456789" }),
      }),
    );
  });
});

describe("getProspectTimeline — filtre workspace", () => {
  test("workspaceFilter null/undefined → aucun filtre workspaceId", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      workspaceFilter: null,
    });
    const callArg = mocks.transitionFindMany.mock.calls[0]![0];
    expect(callArg.where.workspaceId).toBeUndefined();
  });

  test("workspaceFilter [] → sentinel '__none__' (aucun résultat sans casser Prisma)", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      workspaceFilter: [],
    });
    const callArg = mocks.transitionFindMany.mock.calls[0]![0];
    expect(callArg.where.workspaceId).toEqual({ in: ["__none__"] });
  });

  test("workspaceFilter [ids] → restrict à ces ids", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      workspaceFilter: ["ws-1", "ws-2"],
    });
    const callArg = mocks.transitionFindMany.mock.calls[0]![0];
    expect(callArg.where.workspaceId).toEqual({ in: ["ws-1", "ws-2"] });
  });
});

describe("getProspectTimeline — filtre types", () => {
  test("types === undefined → toutes les sources sont interrogées", async () => {
    await getProspectTimeline({ siren: "123456789", tenantId: "t-1" });
    expect(mocks.transitionFindMany).toHaveBeenCalled();
    expect(mocks.followupFindMany).toHaveBeenCalled();
    expect(mocks.appointmentFindMany).toHaveBeenCalled();
  });

  test("types === [] → AUCUNE source interrogée (sécurité côté route whitelist)", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: [],
    });
    expect(mocks.transitionFindMany).not.toHaveBeenCalled();
    expect(mocks.followupFindMany).not.toHaveBeenCalled();
    expect(mocks.appointmentFindMany).not.toHaveBeenCalled();
  });

  test("types === ['pipeline_transition'] → uniquement cette source", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["pipeline_transition"],
    });
    expect(mocks.transitionFindMany).toHaveBeenCalled();
    expect(mocks.followupFindMany).not.toHaveBeenCalled();
    expect(mocks.appointmentFindMany).not.toHaveBeenCalled();
  });

  test("types === ['followup', 'appointment'] → ces 2 sources, pas la transition", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["followup", "appointment"],
    });
    expect(mocks.transitionFindMany).not.toHaveBeenCalled();
    expect(mocks.followupFindMany).toHaveBeenCalled();
    expect(mocks.appointmentFindMany).toHaveBeenCalled();
  });
});

describe("getProspectTimeline — merge + tri descending", () => {
  test("merge 3 sources et trie par occurredAt desc", async () => {
    mocks.transitionFindMany.mockResolvedValue([
      {
        id: "tr-1",
        occurredAt: new Date("2026-05-20T10:00:00Z"),
        fromStage: "a_rappeler",
        toStage: "site_demo",
        userId: "u-1",
      },
    ]);
    mocks.followupFindMany.mockResolvedValue([
      {
        id: 42,
        scheduledAt: "2026-05-23T14:00:00.000Z",
        status: "pending",
        note: "Relancer demain",
      },
    ]);
    mocks.appointmentFindMany.mockResolvedValue([
      {
        id: "appt-1",
        startAt: new Date("2026-05-22T16:00:00Z"),
        title: "Demo Q3",
        status: "scheduled",
        notes: null,
        sourceStage: "site_demo",
      },
    ]);

    const events = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
    });
    expect(events).toHaveLength(3);
    // Tri descending : followup 23 mai > appointment 22 mai > transition 20 mai
    expect(events[0].type).toBe("followup");
    expect(events[1].type).toBe("appointment");
    expect(events[2].type).toBe("pipeline_transition");
  });

  test("shape de normalisation — pipeline_transition expose toStage/fromStage", async () => {
    mocks.transitionFindMany.mockResolvedValue([
      {
        id: "tr-1",
        occurredAt: new Date("2026-05-20T10:00:00Z"),
        fromStage: null,
        toStage: "fiche_ouverte",
        userId: null,
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["pipeline_transition"],
    });
    expect(evt).toMatchObject({
      type: "pipeline_transition",
      id: "tr-1",
      fromStage: null,
      toStage: "fiche_ouverte",
      userId: null,
    });
    // occurredAt sérialisé en ISO string
    expect(typeof evt.occurredAt).toBe("string");
    expect(evt.occurredAt).toBe("2026-05-20T10:00:00.000Z");
  });

  test("shape appointment — startAt → occurredAt ISO, expose title/status/sourceStage", async () => {
    mocks.appointmentFindMany.mockResolvedValue([
      {
        id: "appt-1",
        startAt: new Date("2026-05-22T16:00:00Z"),
        title: "Demo Q3",
        status: "scheduled",
        notes: "Notes du RDV",
        sourceStage: "site_demo",
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["appointment"],
    });
    expect(evt).toMatchObject({
      type: "appointment",
      id: "appt-1",
      title: "Demo Q3",
      status: "scheduled",
      notes: "Notes du RDV",
      sourceStage: "site_demo",
      occurredAt: "2026-05-22T16:00:00.000Z",
    });
  });

  test("shape followup — scheduledAt String passé tel quel à occurredAt", async () => {
    mocks.followupFindMany.mockResolvedValue([
      {
        id: 7,
        scheduledAt: "2026-05-23T14:00:00.000Z",
        status: "pending",
        note: "Rappel imp.",
      },
    ]);
    const [evt] = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      types: ["followup"],
    });
    expect(evt).toMatchObject({
      type: "followup",
      id: "7",
      occurredAt: "2026-05-23T14:00:00.000Z",
      status: "pending",
      note: "Rappel imp.",
    });
  });
});

describe("getProspectTimeline — filtre date since/until", () => {
  test("since filtre les events plus anciens (appliqué post-merge sur followups)", async () => {
    // since=2026-05-21 → la transition du 20 mai doit disparaître.
    mocks.transitionFindMany.mockResolvedValue([
      // findMany filtre déjà via Prisma where, on émule
    ]);
    mocks.followupFindMany.mockResolvedValue([
      // findMany ne filtre PAS scheduledAt (String non-dateable) — post-merge requis
      {
        id: 1,
        scheduledAt: "2026-05-19T10:00:00.000Z",
        status: "pending",
        note: "Trop vieux",
      },
      {
        id: 2,
        scheduledAt: "2026-05-23T10:00:00.000Z",
        status: "pending",
        note: "Garde",
      },
    ]);
    mocks.appointmentFindMany.mockResolvedValue([]);

    const events = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      since: "2026-05-21T00:00:00Z",
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { id: string }).id).toBe("2");
  });

  test("until filtre les events plus récents (post-merge)", async () => {
    mocks.followupFindMany.mockResolvedValue([
      {
        id: 1,
        scheduledAt: "2026-05-19T10:00:00.000Z",
        status: "pending",
        note: "Garde",
      },
      {
        id: 2,
        scheduledAt: "2026-05-25T10:00:00.000Z",
        status: "pending",
        note: "Trop tard",
      },
    ]);

    const events = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      until: "2026-05-20T00:00:00Z",
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { id: string }).id).toBe("1");
  });
});

describe("getProspectTimeline — limit", () => {
  test("limit par défaut = 200, passé à take Prisma", async () => {
    await getProspectTimeline({ siren: "123456789", tenantId: "t-1" });
    expect(mocks.transitionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  test("limit custom appliqué au take Prisma", async () => {
    await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      limit: 50,
    });
    expect(mocks.transitionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  test("slice final = limit même si merge > limit", async () => {
    // 3 events au total, limit 2 → seulement 2 retournés
    mocks.transitionFindMany.mockResolvedValue([
      {
        id: "tr-1",
        occurredAt: new Date("2026-05-22T10:00:00Z"),
        fromStage: null,
        toStage: "fiche_ouverte",
        userId: null,
      },
      {
        id: "tr-2",
        occurredAt: new Date("2026-05-21T10:00:00Z"),
        fromStage: "fiche_ouverte",
        toStage: "repondeur",
        userId: null,
      },
      {
        id: "tr-3",
        occurredAt: new Date("2026-05-20T10:00:00Z"),
        fromStage: "repondeur",
        toStage: "a_rappeler",
        userId: null,
      },
    ]);
    const events = await getProspectTimeline({
      siren: "123456789",
      tenantId: "t-1",
      limit: 2,
    });
    expect(events).toHaveLength(2);
    // Les 2 plus récents
    expect((events[0] as { id: string }).id).toBe("tr-1");
    expect((events[1] as { id: string }).id).toBe("tr-2");
  });
});
