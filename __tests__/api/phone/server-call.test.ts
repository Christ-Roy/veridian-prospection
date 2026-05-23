/**
 * Tests des routes /api/phone/server-call (POST, GET, DELETE).
 *
 * 2026-05-20 : test focus sur le sync status ↔ pipeline_stage pour les
 * events phone (mapping canonique src/lib/outreach/status.ts).
 * 2026-05-23 : renforcement assertions body retourné (pattern bug
 * invitations Supabase).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { pipelineStageForStatus } from "@/lib/outreach/status";

vi.hoisted(() => {
  process.env.TELNYX_API_KEY = "telnyx-test-key";
  process.env.TELNYX_CALL_CONTROL_APP_ID = "call-control-app-id";
  process.env.TELNYX_PHONE_NUMBER = "+33974066175";
});

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
    callLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { POST, GET, DELETE } from "@/app/api/phone/server-call/route";
import { makeRequest, readJson } from "../_helpers";

function defaultAuthCtx() {
  requireAuthMock.mockResolvedValue({
    user: { id: "u-1", email: "u@v.site" },
  });
  getTenantIdMock.mockResolvedValue("t-1");
  getWorkspaceScopeMock.mockResolvedValue({ insertId: "w-1" });
}

describe("/api/phone/server-call", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore fetch stub between tests
    if ((global as { fetch?: unknown }).fetch) {
      vi.unstubAllGlobals();
    }
  });

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

    test("returns 400 quand number manquant", async () => {
      defaultAuthCtx();
      const res = await POST(
        makeRequest("/api/phone/server-call", {
          method: "POST",
          body: { siren: "123456789" },
        }),
      );
      expect(res.status).toBe(400);
      const body = (await readJson(res)) as { error: string };
      expect(body).toEqual({ error: "Missing number" });
    });

    test("happy path : crée callLog, appelle Telnyx, retourne {ok, callId, callControlId, message}", async () => {
      defaultAuthCtx();
      prismaMock.callLog.create.mockResolvedValue({ id: 42 });
      prismaMock.callLog.update.mockResolvedValue({ id: 42 });
      // Stub fetch global pour Telnyx
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            data: { call_control_id: "call-ctl-xyz" },
          }),
        }),
      );

      const res = await POST(
        makeRequest("/api/phone/server-call", {
          method: "POST",
          body: { number: "0612345678", siren: "123456789" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toEqual({
        ok: true,
        callId: 42,
        callControlId: "call-ctl-xyz",
        message: "Appel lance via Telnyx.",
      });
    });

    test("returns 500 quand Telnyx API throw — callLog passé en 'failed'", async () => {
      defaultAuthCtx();
      prismaMock.callLog.create.mockResolvedValue({ id: 99 });
      prismaMock.callLog.update.mockResolvedValue({ id: 99 });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Telnyx unreachable")),
      );

      const res = await POST(
        makeRequest("/api/phone/server-call", {
          method: "POST",
          body: { number: "0612345678" },
        }),
      );
      expect(res.status).toBe(500);
      const body = (await readJson(res)) as { error: string };
      expect(body).toEqual({ error: "Telnyx unreachable" });
      // callLog doit avoir été passé en 'failed' (anti-régression cleanup).
      expect(prismaMock.callLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 99 },
          data: { status: "failed" },
        }),
      );
    });

    test("invariant : appel initié = status 'appele' mappe vers pipeline_stage 'repondeur'", () => {
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

    test("retourne le status configuré {provider, status, phone_number}", async () => {
      defaultAuthCtx();
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toEqual({
        provider: "telnyx",
        status: "configured",
        phone_number: "+33974066175",
      });
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

    test("retourne {ok:true, message} pour DELETE authentifié", async () => {
      defaultAuthCtx();
      const res = await DELETE();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toEqual({
        ok: true,
        message: "Use client-side hangup for WebRTC calls",
      });
    });
  });
});
