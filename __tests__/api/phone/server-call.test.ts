/**
 * Tests des routes /api/phone/server-call (POST, GET, DELETE).
 *
 * 2026-05-20 : ajout d'un test focus sur le sync status ↔ pipeline_stage
 * pour les events phone. Quand un appel sortant est initié, on doit écrire
 * status='appele' ET pipeline_stage='repondeur' (mapping canonique
 * src/lib/outreach/status.ts).
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
    callLog: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/supabase/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { POST, GET, DELETE } from "@/app/api/phone/server-call/route";
import { makeRequest } from "../_helpers";

describe("/api/phone/server-call", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("POST", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await POST(
        makeRequest("/api/phone/server-call", { method: "POST", body: {} }),
      );
      expect(res.status).toBe(401);
    });

    test("invariant : appel initié = status 'appele' mappe vers pipeline_stage 'repondeur'", () => {
      // Couvre la cohérence SQL inline de server-call/route.ts:125-128 qui
      // écrit status='appele' + pipeline_stage='repondeur' lors d'un call init.
      // Test de l'invariant logique (le mapping canonique), pas du SQL lui-même.
      expect(pipelineStageForStatus("appele")).toBe("repondeur");
    });
  });

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET();
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await DELETE();
      expect(res.status).toBe(401);
    });
  });
});
