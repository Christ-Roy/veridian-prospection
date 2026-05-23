/**
 * Tests de POST /api/phone/call-log.
 *
 * 2026-05-20 : ajout d'invariants sur le sync status ↔ pipeline_stage pour
 * les events manual call log.
 * 2026-05-23 : renforcement assertions body retourné (pattern bug
 * invitations Supabase).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { pipelineStageForStatus } from "@/lib/outreach/status";

const {
  requireAuthMock,
  getTenantIdMock,
  getWorkspaceScopeMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  prismaMock: {
    callLog: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    followup: { create: vi.fn() },
    claudeActivity: { create: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { POST } from "@/app/api/phone/call-log/route";
import { makeRequest, readJson } from "../_helpers";

function defaultAuthCtx() {
  requireAuthMock.mockResolvedValue({
    user: { id: "u-1", email: "u@v.site" },
  });
  getTenantIdMock.mockResolvedValue("t-1");
  getWorkspaceScopeMock.mockResolvedValue({ insertId: "w-1" });
}

describe("POST /api/phone/call-log", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/phone/call-log", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(401);
  });

  test("invariant : 'appele' (call answered ≥30s) mappe vers 'repondeur'", () => {
    expect(pipelineStageForStatus("appele")).toBe("repondeur");
  });

  test("invariant : 'rappeler' (no answer / call court) mappe vers 'a_rappeler'", () => {
    expect(pipelineStageForStatus("rappeler")).toBe("a_rappeler");
  });

  // Anti-régression sabotage L36 : la branche `status: "initiated"` part vers
  // handleInitiation. Si return await handleInitiation devient `return null`,
  // ce test crashe (res.status undefined).
  test("INITIATION : status='initiated' crée un callLog et retourne {ok, callId}", async () => {
    defaultAuthCtx();
    prismaMock.callLog.create.mockResolvedValue({ id: 1234 });

    const res = await POST(
      makeRequest("/api/phone/call-log", {
        method: "POST",
        body: {
          status: "initiated",
          direction: "outgoing",
          provider: "telnyx",
          from_number: "+33974066175",
          to_number: "+33612345678",
          siren: "123456789",
          started_at: "2026-05-23T10:00:00.000Z",
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, callId: 1234 });

    // Vérifie que la création a bien propagé tenant/workspace/user.
    expect(prismaMock.callLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "outgoing",
        provider: "telnyx",
        toNumber: "+33612345678",
        siren: "123456789",
        status: "initiated",
        tenantId: "t-1",
        workspaceId: "w-1",
        userId: "u-1",
      }),
    });
  });

  test("COMPLETION : appel sans match précédent crée un callLog et retourne {ok, callId}", async () => {
    defaultAuthCtx();
    prismaMock.callLog.findFirst.mockResolvedValue(null); // pas de match
    prismaMock.callLog.create.mockResolvedValue({ id: 5678 });

    const res = await POST(
      makeRequest("/api/phone/call-log", {
        method: "POST",
        body: {
          number: "+33612345678",
          siren: "987654321",
          duration: 45,
          answered: true,
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, callId: 5678 });
  });

  test("returns 500 si la création callLog échoue", async () => {
    defaultAuthCtx();
    prismaMock.callLog.create.mockRejectedValue(new Error("DB unreachable"));

    const res = await POST(
      makeRequest("/api/phone/call-log", {
        method: "POST",
        body: { status: "initiated", to_number: "+33612345678" },
      }),
    );
    expect(res.status).toBe(500);
    const body = (await readJson(res)) as { error: string };
    expect(body).toEqual({ error: "DB unreachable" });
  });
});
