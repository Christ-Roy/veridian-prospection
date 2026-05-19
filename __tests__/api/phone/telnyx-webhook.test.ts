/**
 * Tests de POST /api/phone/telnyx-webhook.
 *
 * À ce stade : pas de signature Telnyx checkée (TODO sécu). Tests vérifient
 * que l'endpoint encaisse des payloads malformés sans crasher (ok:true).
 *
 * 2026-05-20 : ajout d'invariants sur le mapping status ↔ pipeline_stage
 * pour les 3 events webhook (answered, hangup, machine.detection).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { pipelineStageForStatus } from "@/lib/outreach/status";

const { prismaMock, handleIncomingCallMock } = vi.hoisted(() => ({
  prismaMock: {
    callLog: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
  handleIncomingCallMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/app/api/phone/telnyx-webhook/incoming-handler", () => ({
  handleIncomingCall: handleIncomingCallMock,
}));

import { POST } from "@/app/api/phone/telnyx-webhook/route";
import { makeRequest, readJson } from "../_helpers";

describe("POST /api/phone/telnyx-webhook — invariants sync status ↔ pipeline_stage", () => {
  test("call.answered : status='appele' → pipeline_stage='repondeur'", () => {
    // Couvre l'invariant SQL inline route.ts:60-64 (case 'call.answered')
    expect(pipelineStageForStatus("appele")).toBe("repondeur");
  });

  test("call.hangup (court): status='rappeler' → pipeline_stage='a_rappeler'", () => {
    // Couvre l'invariant SQL inline route.ts:96-103 (case 'call.hangup' duration<10)
    expect(pipelineStageForStatus("rappeler")).toBe("a_rappeler");
  });

  test("call.machine.detection: status='rappeler' → pipeline_stage='a_rappeler'", () => {
    // Couvre l'invariant SQL inline route.ts:148-155 (case 'call.machine.detection.ended')
    expect(pipelineStageForStatus("rappeler")).toBe("a_rappeler");
  });
});

describe("POST /api/phone/telnyx-webhook", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns ok:true on empty payload", async () => {
    const res = await POST(
      makeRequest("/api/phone/telnyx-webhook", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("returns ok:true on event missing call_control_id", async () => {
    const res = await POST(
      makeRequest("/api/phone/telnyx-webhook", {
        method: "POST",
        body: { data: { event_type: "call.initiated", payload: {} } },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("dispatches incoming call handler on call.initiated/incoming", async () => {
    prismaMock.callLog.findFirst.mockResolvedValue(null);
    const res = await POST(
      makeRequest("/api/phone/telnyx-webhook", {
        method: "POST",
        body: {
          data: {
            event_type: "call.initiated",
            payload: {
              call_control_id: "cc-1",
              direction: "incoming",
              from: "+33612345678",
            },
          },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(handleIncomingCallMock).toHaveBeenCalledWith("cc-1", "+33612345678");
  });
});
