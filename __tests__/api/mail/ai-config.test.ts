/**
 * Tests routes /api/mail/ai-config — GET + PUT + DELETE.
 *
 * Couvre :
 *  - RBAC requireAdmin sur GET/PUT/DELETE (403 si non admin)
 *  - 401 si pas auth
 *  - GET retourne flag apiKeyConfigured, JAMAIS la clé
 *  - PUT rejette payload invalide (Zod) + provider hors whitelist
 *  - PUT rate limit 429
 *  - DELETE idempotent
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAdminMock,
  isRateLimitedMock,
  logAuditMock,
  getAiConfigPublicMock,
  upsertAiConfigMock,
  deleteAiConfigMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  logAuditMock: vi.fn(),
  getAiConfigPublicMock: vi.fn(),
  upsertAiConfigMock: vi.fn(),
  deleteAiConfigMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/ai/queries", () => ({
  getAiConfigPublic: getAiConfigPublicMock,
  upsertAiConfig: upsertAiConfigMock,
  deleteAiConfig: deleteAiConfigMock,
}));

import { GET, PUT, DELETE } from "@/app/api/mail/ai-config/route";
import { makeRequest, readJson } from "../_helpers";

const ADMIN_CTX = {
  userId: "u-admin",
  email: "admin@veridian.site",
  tenantId: "t-1",
  tenantOwnerId: "u-admin",
  isAdmin: true,
  activeWorkspaceId: null,
  workspaces: [],
};

describe("/api/mail/ai-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  describe("GET", () => {
    test("401 si pas auth", async () => {
      requireAdminMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET();
      expect(res.status).toBe(401);
    });

    test("403 si user pas admin", async () => {
      requireAdminMock.mockResolvedValue({
        error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      });
      const res = await GET();
      expect(res.status).toBe(403);
    });

    test("retourne la config publique (sans la clé API)", async () => {
      requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
      getAiConfigPublicMock.mockResolvedValue({
        provider: "anthropic",
        model: "claude-opus-4-7",
        defaultLocale: "fr",
        apiKeyConfigured: true,
        lastUsedAt: null,
        totalTokensIn: 0,
        totalTokensOut: 0,
      });
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body.apiKeyConfigured).toBe(true);
      expect(body).not.toHaveProperty("apiKey");
      expect(body).not.toHaveProperty("apiKeyEnc");
    });

    test("retourne config vide par défaut si jamais configurée", async () => {
      requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
      getAiConfigPublicMock.mockResolvedValue(null);
      const res = await GET();
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body.apiKeyConfigured).toBe(false);
      expect(body.provider).toBeNull();
    });
  });

  describe("PUT", () => {
    test("401 si pas auth", async () => {
      requireAdminMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await PUT(makeRequest("/api/mail/ai-config", { method: "PUT", body: {} }));
      expect(res.status).toBe(401);
    });

    test("403 si user pas admin", async () => {
      requireAdminMock.mockResolvedValue({
        error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      });
      const res = await PUT(makeRequest("/api/mail/ai-config", { method: "PUT", body: {} }));
      expect(res.status).toBe(403);
    });

    test("429 si rate limited", async () => {
      requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
      isRateLimitedMock.mockReturnValue(true);
      const res = await PUT(makeRequest("/api/mail/ai-config", { method: "PUT", body: {} }));
      expect(res.status).toBe(429);
    });

    test("400 si payload invalide (provider hors enum)", async () => {
      requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
      const res = await PUT(
        makeRequest("/api/mail/ai-config", {
          method: "PUT",
          body: { provider: "groq", model: "x", apiKey: "12345678" },
        }),
      );
      expect(res.status).toBe(400);
    });

    test("400 si apiKey trop court (< 8 char)", async () => {
      requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
      const res = await PUT(
        makeRequest("/api/mail/ai-config", {
          method: "PUT",
          body: { provider: "anthropic", model: "claude-opus-4-7", apiKey: "x" },
        }),
      );
      expect(res.status).toBe(400);
    });

    test("400 si upsertAiConfig throw (model hors whitelist)", async () => {
      requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
      upsertAiConfigMock.mockRejectedValue(new Error("Unsupported (provider, model) combo"));
      const res = await PUT(
        makeRequest("/api/mail/ai-config", {
          method: "PUT",
          body: {
            provider: "anthropic",
            model: "claude-fake",
            apiKey: "sk-ant-xxxxxxxx",
          },
        }),
      );
      expect(res.status).toBe(400);
      const body = (await readJson(res)) as { error: string };
      expect(body.error).toMatch(/Unsupported/);
    });

    test("200 sur payload valide + audit log appelé", async () => {
      requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
      const expectedConfig = {
        provider: "anthropic",
        model: "claude-opus-4-7",
        defaultLocale: "fr",
        apiKeyConfigured: true,
        lastUsedAt: null,
        totalTokensIn: 0,
        totalTokensOut: 0,
      };
      upsertAiConfigMock.mockResolvedValue(expectedConfig);
      const res = await PUT(
        makeRequest("/api/mail/ai-config", {
          method: "PUT",
          body: {
            provider: "anthropic",
            model: "claude-opus-4-7",
            apiKey: "sk-ant-xxxxxxxx",
            defaultLocale: "fr",
          },
        }),
      );
      expect(res.status).toBe(200);
      // Asserts sur le retour réel (sabotage `return null` rougit)
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body.provider).toBe("anthropic");
      expect(body.model).toBe("claude-opus-4-7");
      expect(logAuditMock).toHaveBeenCalledTimes(1);
      expect(logAuditMock.mock.calls[0][0].action).toBe("mail.ai_config_updated");
      // L'audit log NE DOIT PAS contenir la clé en clair.
      const auditMeta = logAuditMock.mock.calls[0][0].metadata;
      expect(JSON.stringify(auditMeta)).not.toContain("sk-ant-xxxxxxxx");
    });
  });

  describe("DELETE", () => {
    test("403 si user pas admin", async () => {
      requireAdminMock.mockResolvedValue({
        error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      });
      const res = await DELETE();
      expect(res.status).toBe(403);
    });

    test("200 + audit + appelle deleteAiConfig", async () => {
      requireAdminMock.mockResolvedValue({ ctx: ADMIN_CTX });
      deleteAiConfigMock.mockResolvedValue(undefined);
      const res = await DELETE();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as { ok: boolean };
      expect(body.ok).toBe(true);
      expect(deleteAiConfigMock).toHaveBeenCalledWith("t-1");
      expect(logAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: "mail.ai_config_deleted" }),
      );
    });
  });
});
