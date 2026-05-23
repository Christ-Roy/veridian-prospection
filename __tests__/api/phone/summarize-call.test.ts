/**
 * Tests de POST /api/phone/summarize-call.
 *
 * Pattern fort : assert sur le BODY RETOURNÉ pour chaque branche, pas
 * juste 401. Détecte les changements de mapping ZAI/fallback ou shape
 * { ok, source } (bug invitations 2026-05-23).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.hoisted(() => {
  // Pas de ZAI configuré → branche "fallback" testable directement.
  delete process.env.ZAI_API_KEY;
  delete process.env.ZAI_BASE_URL;
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
    callLog: { findUnique: vi.fn() },
    claudeActivity: { create: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { POST } from "@/app/api/phone/summarize-call/route";
import { makeRequest, readJson } from "../_helpers";

function defaultAuthCtx() {
  requireAuthMock.mockResolvedValue({
    user: { id: "u-1", email: "u@v.site" },
  });
  getTenantIdMock.mockResolvedValue("t-1");
  getWorkspaceScopeMock.mockResolvedValue({ insertId: "w-1" });
}

describe("POST /api/phone/summarize-call", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/phone/summarize-call", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(401);
  });

  // Anti-régression sabotage L40 : la branche "400 Missing siren" est la 1re
  // ligne `return X;` du source. Si elle devient `return null`, ce test
  // crashe (res.status undefined).
  test("returns 400 quand siren manquant (anti-régression sabotage L40)", async () => {
    defaultAuthCtx();
    const res = await POST(
      makeRequest("/api/phone/summarize-call", {
        method: "POST",
        body: { call_id: 42, duration: 30 },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await readJson(res)) as { error: string };
    expect(body).toEqual({ error: "Missing siren" });
  });

  test("fallback summary quand ZAI non configuré → retourne {ok, source: 'fallback'}", async () => {
    defaultAuthCtx();
    prismaMock.callLog.findUnique.mockResolvedValue({
      toNumber: "+33612345678",
      durationSeconds: 45,
      status: "completed",
      startedAt: "2026-05-23T10:00:00.000Z",
      recordingPath: null,
    });
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      {
        nom: "ACME",
        dirigeant: "Jean Dupont",
        ville: "Lyon",
        cms: null,
        has_responsive: 1,
        has_https: 1,
        copyright_year: 2024,
      },
    ]);
    prismaMock.claudeActivity.create.mockResolvedValue({ id: 1 });

    const res = await POST(
      makeRequest("/api/phone/summarize-call", {
        method: "POST",
        body: { call_id: 42, siren: "123456789", duration: 45 },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, source: "fallback" });

    // Vérifie que le résumé fallback est bien persisté.
    expect(prismaMock.claudeActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          siren: "123456789",
          activityType: "call_summary",
          tenantId: "t-1",
          workspaceId: "w-1",
        }),
      }),
    );
  });

  test("retourne 500 si une erreur inattendue est levée pendant le résumé", async () => {
    defaultAuthCtx();
    prismaMock.callLog.findUnique.mockResolvedValue({
      toNumber: "+33612345678",
      durationSeconds: 30,
      status: "completed",
      startedAt: "2026-05-23T10:00:00.000Z",
      recordingPath: null,
    });
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);
    prismaMock.claudeActivity.create.mockRejectedValue(
      new Error("DB activity insert failed"),
    );

    const res = await POST(
      makeRequest("/api/phone/summarize-call", {
        method: "POST",
        body: { call_id: 42, siren: "987654321" },
      }),
    );
    expect(res.status).toBe(500);
    const body = (await readJson(res)) as { error: string };
    expect(body).toEqual({ error: "DB activity insert failed" });
  });
});
