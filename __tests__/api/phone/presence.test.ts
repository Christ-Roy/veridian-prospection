/**
 * Tests des routes /api/phone/presence (GET, POST).
 *
 * Pattern fort : assert sur le BODY RETOURNÉ ({online, lastSeen} pour GET,
 * {ok, online} pour POST). Détecte changement de shape ou de mapping.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { requireAuthMock, getTenantIdMock, queriesMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  queriesMock: { getSetting: vi.fn(), setSetting: vi.fn() },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/queries", () => queriesMock);

import { GET, POST } from "@/app/api/phone/presence/route";
import { makeRequest, readJson } from "../_helpers";

describe("/api/phone/presence", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET();
      expect(res.status).toBe(401);
    });

    // Anti-régression sabotage L18 : la branche return NextResponse.json
    // ({online, lastSeen}) est la 1re return du source. Si elle devient
    // `return null`, ce test crashe.
    test("retourne {online:true, lastSeen} quand webrtc_online = 'true'", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      queriesMock.getSetting.mockImplementation(async (key: string) => {
        if (key === "settings.webrtc_online") return "true";
        if (key === "settings.webrtc_last_seen")
          return "2026-05-23T10:00:00.000Z";
        return null;
      });

      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toEqual({
        online: true,
        lastSeen: "2026-05-23T10:00:00.000Z",
      });
    });

    test("retourne {online:false, lastSeen:null} quand jamais connecté", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-2", email: "x@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-2");
      queriesMock.getSetting.mockResolvedValue(null);

      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toEqual({ online: false, lastSeen: null });
    });

    test("online === string 'true' strict (pas truthy)", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-3", email: "y@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-3");
      // Si quelqu'un stocke "1" au lieu de "true", online doit rester false.
      queriesMock.getSetting.mockImplementation(async (key: string) => {
        if (key === "settings.webrtc_online") return "1";
        return null;
      });

      const res = await GET();
      const body = (await readJson(res)) as { online: boolean };
      expect(body.online).toBe(false); // strict equality "true"
    });
  });

  describe("POST", () => {
    test("returns 401 when unauthenticated", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await POST(
        makeRequest("/api/phone/presence", { method: "POST", body: {} }),
      );
      expect(res.status).toBe(401);
    });

    test("set online=true et retourne {ok, online:true}", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      queriesMock.setSetting.mockResolvedValue(undefined);

      const res = await POST(
        makeRequest("/api/phone/presence", {
          method: "POST",
          body: { online: true },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toEqual({ ok: true, online: true });

      // Vérifie que les 2 settings (online + last_seen) sont écrits.
      expect(queriesMock.setSetting).toHaveBeenCalledWith(
        "settings.webrtc_online",
        "true",
        "t-1",
      );
      expect(queriesMock.setSetting).toHaveBeenCalledWith(
        "settings.webrtc_last_seen",
        expect.any(String),
        "t-1",
      );
    });

    test("set online=false (truthy non-true → false) et retourne {ok, online:false}", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      queriesMock.setSetting.mockResolvedValue(undefined);

      const res = await POST(
        makeRequest("/api/phone/presence", {
          method: "POST",
          body: { online: "yes" }, // strict !== true
        }),
      );
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body).toEqual({ ok: true, online: false });
    });
  });
});
