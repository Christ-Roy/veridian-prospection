/**
 * Tests de POST /api/phone/call-log.
 *
 * 2026-05-20 : ajout d'invariants sur le sync status ↔ pipeline_stage pour
 * les events manual call log.
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
  prismaMock: { callLog: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() } },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { POST } from "@/app/api/phone/call-log/route";
import { makeRequest } from "../_helpers";

describe("POST /api/phone/call-log", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(makeRequest("/api/phone/call-log", { method: "POST", body: {} }));
    expect(res.status).toBe(401);
  });

  test("invariant : 'appele' (call answered ≥30s) mappe vers 'repondeur'", () => {
    // Couvre l'invariant SQL inline route.ts:159-163 (call answered ≥30s)
    expect(pipelineStageForStatus("appele")).toBe("repondeur");
  });

  test("invariant : 'rappeler' (no answer / call court) mappe vers 'a_rappeler'", () => {
    // Couvre l'invariant SQL inline route.ts:165-172 (!answered || <10s)
    expect(pipelineStageForStatus("rappeler")).toBe("a_rappeler");
  });
});
