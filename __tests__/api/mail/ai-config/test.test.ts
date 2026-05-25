/**
 * Tests route /api/mail/ai-config/test — POST.
 *
 * Couvre :
 *  - RBAC requireAdmin
 *  - 412 si pas configuré
 *  - 429 rate limited
 *  - 401 si clé invalide (adapter renvoie kind=auth)
 *  - 200 + message si succès
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAdminMock,
  isRateLimitedMock,
  getAiConfigInternalMock,
  recordAiUsageMock,
  getAdapterMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  getAiConfigInternalMock: vi.fn(),
  recordAiUsageMock: vi.fn(),
  getAdapterMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/ai/queries", () => ({
  getAiConfigInternal: getAiConfigInternalMock,
  recordAiUsage: recordAiUsageMock,
}));
vi.mock("@/lib/ai/adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/adapter")>("@/lib/ai/adapter");
  return {
    ...actual,
    getAdapter: getAdapterMock,
  };
});

import { POST } from "@/app/api/mail/ai-config/test/route";
import { AiAdapterError } from "@/lib/ai/adapter";
import { readJson } from "../../_helpers";

const ADMIN_CTX = {
  userId: "u-admin",
  email: "admin@veridian.site",
  tenantId: "t-1",
  tenantOwnerId: "u-admin",
  isAdmin: true,
  activeWorkspaceId: null,
  workspaces: [],
};

describe("/api/mail/ai-config/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  test("403 si pas admin", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await POST();
    expect(res.status).toBe(403);
  });

  test("429 si rate limited", async () => {
    requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST();
    expect(res.status).toBe(429);
  });

  test("412 si AI pas configurée", async () => {
    requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
    getAiConfigInternalMock.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(412);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("not_configured");
  });

  test("401 si la clé est invalide (adapter kind=auth)", async () => {
    requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
    getAiConfigInternalMock.mockResolvedValue({
      id: "id",
      tenantId: "t-1",
      provider: "anthropic",
      model: "claude-opus-4-7",
      apiKeyEnc: "iv:tag:c",
      defaultLocale: "fr",
    });
    getAdapterMock.mockReturnValue({
      generateText: vi.fn().mockRejectedValue(new AiAdapterError("auth", "401 invalid key")),
    });
    const res = await POST();
    expect(res.status).toBe(401);
  });

  test("200 + message en retour si succès", async () => {
    requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
    getAiConfigInternalMock.mockResolvedValue({
      id: "id",
      tenantId: "t-1",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      apiKeyEnc: "iv:tag:c",
      defaultLocale: "fr",
    });
    getAdapterMock.mockReturnValue({
      generateText: vi.fn().mockResolvedValue({
        text: "Bonjour !",
        tokensIn: 12,
        tokensOut: 3,
      }),
    });
    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.message).toBe("Bonjour !");
    expect(body.tokensIn).toBe(12);
    expect(body.tokensOut).toBe(3);
  });
});
