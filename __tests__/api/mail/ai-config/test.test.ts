/**
 * Tests route /api/mail/ai-config/test — POST.
 *
 * Couvre :
 *  - RBAC requireAdmin
 *  - 412 si pas configuré (resolver retourne null = ni link user, ni tenant
 *     config, ni clé Veridian globale)
 *  - 429 rate limited
 *  - 401 si clé invalide (adapter renvoie kind=auth)
 *  - 200 + message en mode tenant-byo, veridian-free, user-byo (Palier 1+2)
 *  - recordAiUsage uniquement en mode tenant-byo, recordOpenRouterLinkUsage
 *     uniquement en mode user-byo, ni l'un ni l'autre en veridian-free.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAdminMock,
  isRateLimitedMock,
  recordAiUsageMock,
  resolveAdapterMock,
  recordOpenRouterLinkUsageMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  recordAiUsageMock: vi.fn(),
  resolveAdapterMock: vi.fn(),
  recordOpenRouterLinkUsageMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/ai/queries", () => ({ recordAiUsage: recordAiUsageMock }));
vi.mock("@/lib/ai/resolver", () => ({ resolveAdapter: resolveAdapterMock }));
vi.mock("@/lib/openrouter/queries", () => ({
  recordOpenRouterLinkUsage: recordOpenRouterLinkUsageMock,
}));

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

  test("412 si aucune voie résolue (resolver = null)", async () => {
    requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
    resolveAdapterMock.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(412);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("not_configured");
  });

  test("401 si la clé est invalide (adapter kind=auth)", async () => {
    requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
    resolveAdapterMock.mockResolvedValue({
      adapter: {
        generateText: vi.fn().mockRejectedValue(new AiAdapterError("auth", "401 invalid key")),
      },
      mode: "tenant-byo",
      provider: "anthropic",
      model: "claude-opus-4-7",
      tenantId: "t-1",
    });
    const res = await POST();
    expect(res.status).toBe(401);
  });

  test("200 + message + recordAiUsage en mode tenant-byo", async () => {
    requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
    resolveAdapterMock.mockResolvedValue({
      adapter: {
        generateText: vi.fn().mockResolvedValue({
          text: "Bonjour !",
          tokensIn: 12,
          tokensOut: 3,
        }),
      },
      mode: "tenant-byo",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      tenantId: "t-1",
    });
    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.message).toBe("Bonjour !");
    expect(body.mode).toBe("tenant-byo");
    expect(body.provider).toBe("anthropic");
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.tokensIn).toBe(12);
    expect(body.tokensOut).toBe(3);
    // tenant-byo bump tenant_ai_config (recordAiUsage), pas le link user
    expect(recordAiUsageMock).toHaveBeenCalledWith("t-1", 12, 3);
    expect(recordOpenRouterLinkUsageMock).not.toHaveBeenCalled();
  });

  test("200 + mode=veridian-free, ne bump NI tenant NI link user", async () => {
    requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
    resolveAdapterMock.mockResolvedValue({
      adapter: {
        generateText: vi.fn().mockResolvedValue({
          text: "Hello from free tier",
          tokensIn: 8,
          tokensOut: 4,
        }),
      },
      mode: "veridian-free",
      provider: "openrouter",
      model: "meta-llama/llama-3.3-70b-instruct:free",
    });
    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("veridian-free");
    // Aucun bump : clé globale partagée, pas de row DB à update
    expect(recordAiUsageMock).not.toHaveBeenCalled();
    expect(recordOpenRouterLinkUsageMock).not.toHaveBeenCalled();
  });

  test("200 + mode=user-byo, bump uniquement le link user (Palier 2)", async () => {
    requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
    resolveAdapterMock.mockResolvedValue({
      adapter: {
        generateText: vi.fn().mockResolvedValue({
          text: "Hello from my OAuth-linked OpenRouter account",
          tokensIn: 10,
          tokensOut: 7,
        }),
      },
      mode: "user-byo",
      provider: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      userId: "u-admin",
    });
    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.mode).toBe("user-byo");
    expect(recordOpenRouterLinkUsageMock).toHaveBeenCalledWith("u-admin");
    expect(recordAiUsageMock).not.toHaveBeenCalled();
  });
});
