/**
 * Tests de POST /api/phone/telnyx-token (génère un JWT WebRTC).
 *
 * Pattern fort : assert sur le BODY RETOURNÉ (notamment le token JWT).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Module-load env capture — pour les tests "non configuré" on doit
// re-importer via vi.resetModules.
vi.hoisted(() => {
  delete process.env.TELNYX_API_KEY;
  delete process.env.TELNYX_CREDENTIAL_ID;
});

const { requireAuthMock, getTenantIdMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));

import { POST } from "@/app/api/phone/telnyx-token/route";
import { readJson } from "../_helpers";

describe("POST /api/phone/telnyx-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if ((global as { fetch?: unknown }).fetch) {
      vi.unstubAllGlobals();
    }
  });

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST();
    expect(res.status).toBe(401);
  });

  test("returns 500 when Telnyx credentials not configured (env captured at module load)", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    const res = await POST();
    expect(res.status).toBe(500);
    const body = (await readJson(res)) as { error: string };
    expect(body).toEqual({ error: "Telnyx credentials not configured" });
  });

  // Anti-régression sabotage L50 : la branche `return NextResponse.json({token})`
  // (cas Telnyx OK) est la 1re ligne return non-conditionnelle du happy path.
  // Si elle devient `return null`, ce test crashe.
  test("happy path : appelle Telnyx et retourne {token: <jwt>}", async () => {
    vi.resetModules();
    process.env.TELNYX_API_KEY = "tx-api-key";
    process.env.TELNYX_CREDENTIAL_ID = "cred-id-123";

    vi.doMock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
    vi.doMock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));

    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");

    // Telnyx renvoie le JWT en text/plain
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "eyJ.fake.jwt",
      }),
    );

    try {
      const { POST: POSTreloaded } = await import(
        "@/app/api/phone/telnyx-token/route"
      );
      const res = await POSTreloaded();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as { token: string };
      expect(body).toEqual({ token: "eyJ.fake.jwt" });
    } finally {
      delete process.env.TELNYX_API_KEY;
      delete process.env.TELNYX_CREDENTIAL_ID;
      vi.doUnmock("@/lib/auth/api-auth");
      vi.doUnmock("@/lib/auth/tenant");
      vi.resetModules();
    }
  });

  test("retourne 500 avec error+detail quand Telnyx répond non-OK", async () => {
    vi.resetModules();
    process.env.TELNYX_API_KEY = "tx-api-key";
    process.env.TELNYX_CREDENTIAL_ID = "cred-id-123";

    vi.doMock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
    vi.doMock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));

    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Telnyx internal error",
      }),
    );

    try {
      const { POST: POSTreloaded } = await import(
        "@/app/api/phone/telnyx-token/route"
      );
      const res = await POSTreloaded();
      expect(res.status).toBe(500);
      const body = (await readJson(res)) as { error: string; detail: string };
      expect(body).toEqual({
        error: "Token generation failed",
        detail: "Telnyx internal error",
      });
    } finally {
      delete process.env.TELNYX_API_KEY;
      delete process.env.TELNYX_CREDENTIAL_ID;
      vi.doUnmock("@/lib/auth/api-auth");
      vi.doUnmock("@/lib/auth/tenant");
      vi.resetModules();
    }
  });
});
