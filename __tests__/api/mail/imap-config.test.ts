/**
 * Tests routes /api/mail/imap-config — GET + PUT + DELETE.
 *
 * Sabotage-test : si on enlève requireAdmin et qu'on utilise requireAuth,
 * le test "403 si non-admin" rougirait.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAdminMock,
  isRateLimitedMock,
  logAuditMock,
  getImapConfigPublicMock,
  upsertImapConfigMock,
  clearImapConfigMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  logAuditMock: vi.fn(),
  getImapConfigPublicMock: vi.fn(),
  upsertImapConfigMock: vi.fn(),
  clearImapConfigMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/mail/queries", () => ({
  getImapConfigPublic: getImapConfigPublicMock,
  upsertImapConfig: upsertImapConfigMock,
  clearImapConfig: clearImapConfigMock,
}));

import { GET, PUT, DELETE } from "@/app/api/mail/imap-config/route";
import { makeRequest, readJson } from "../_helpers";

function makeCtx(overrides: Partial<{ userId: string; tenantId: string; isAdmin: boolean }> = {}) {
  return {
    ctx: {
      userId: overrides.userId ?? "u-1",
      email: "u@v.site",
      tenantId: overrides.tenantId ?? "t-1",
      tenantOwnerId: null,
      workspaces: [],
      isAdmin: overrides.isAdmin ?? true,
      activeWorkspaceId: null,
    },
  };
}

describe("/api/mail/imap-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  describe("GET", () => {
    test("401 si non auth", async () => {
      requireAdminMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET();
      expect(res.status).toBe(401);
    });

    test("403 si non-admin", async () => {
      requireAdminMock.mockResolvedValue({
        error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      });
      const res = await GET();
      expect(res.status).toBe(403);
    });

    test("retourne config IMAP publique (sans password)", async () => {
      requireAdminMock.mockResolvedValue(makeCtx());
      getImapConfigPublicMock.mockResolvedValue({
        host: "imap.x.com",
        port: 993,
        username: "u",
        tls: true,
        folder: "INBOX",
        passwordConfigured: true,
        lastUidSeen: 42,
        lastSyncAt: null,
        lastSyncStatus: "ok",
        lastSyncError: null,
      });
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body.passwordConfigured).toBe(true);
      expect(body).not.toHaveProperty("password");
      expect(body).not.toHaveProperty("passwordEnc");
    });

    test("retourne defaults si pas de row en DB", async () => {
      requireAdminMock.mockResolvedValue(makeCtx());
      getImapConfigPublicMock.mockResolvedValue(null);
      const res = await GET();
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body.host).toBeNull();
      expect(body.folder).toBe("INBOX");
      expect(body.tls).toBe(true);
    });
  });

  describe("PUT", () => {
    test("403 si non-admin", async () => {
      requireAdminMock.mockResolvedValue({
        error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      });
      const res = await PUT(
        makeRequest("http://localhost/api/mail/imap-config", { method: "PUT", body: {} }),
      );
      expect(res.status).toBe(403);
    });

    test("429 si rate limited", async () => {
      requireAdminMock.mockResolvedValue(makeCtx());
      isRateLimitedMock.mockReturnValue(true);
      const res = await PUT(
        makeRequest("http://localhost/api/mail/imap-config", { method: "PUT", body: {} }),
      );
      expect(res.status).toBe(429);
    });

    test("400 si payload invalide", async () => {
      requireAdminMock.mockResolvedValue(makeCtx());
      const res = await PUT(
        makeRequest("http://localhost/api/mail/imap-config", {
          method: "PUT",
          body: { host: "x" }, // manque port/username/tls/folder
        }),
      );
      expect(res.status).toBe(400);
    });

    test("upsert OK avec password fourni → audit log écrit", async () => {
      requireAdminMock.mockResolvedValue(makeCtx());
      upsertImapConfigMock.mockResolvedValue({
        host: "imap.x.com",
        port: 993,
        username: "u",
        tls: true,
        folder: "INBOX",
        passwordConfigured: true,
        lastUidSeen: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
      });
      const res = await PUT(
        makeRequest("http://localhost/api/mail/imap-config", {
          method: "PUT",
          body: {
            host: "imap.x.com",
            port: 993,
            username: "u",
            password: "secret",
            tls: true,
            folder: "INBOX",
          },
        }),
      );
      expect(res.status).toBe(200);
      expect(upsertImapConfigMock).toHaveBeenCalled();
      expect(logAuditMock).toHaveBeenCalled();
      const auditArgs = logAuditMock.mock.calls[0][0];
      expect(auditArgs.action).toBe("mail.imap_config_updated");
      expect(auditArgs.metadata.passwordRotated).toBe(true);
    });

    test("upsert sans password fourni → passwordRotated false", async () => {
      requireAdminMock.mockResolvedValue(makeCtx());
      upsertImapConfigMock.mockResolvedValue({
        host: "imap.x.com",
        port: 993,
        username: "u",
        tls: true,
        folder: "INBOX",
        passwordConfigured: true,
        lastUidSeen: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
      });
      await PUT(
        makeRequest("http://localhost/api/mail/imap-config", {
          method: "PUT",
          body: {
            host: "imap.x.com",
            port: 993,
            username: "u",
            tls: true,
            folder: "INBOX",
          },
        }),
      );
      expect(logAuditMock.mock.calls[0][0].metadata.passwordRotated).toBe(false);
    });
  });

  describe("DELETE", () => {
    test("403 si non-admin", async () => {
      requireAdminMock.mockResolvedValue({
        error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      });
      const res = await DELETE();
      expect(res.status).toBe(403);
    });

    test("clear OK + audit log", async () => {
      requireAdminMock.mockResolvedValue(makeCtx());
      clearImapConfigMock.mockResolvedValue(undefined);
      const res = await DELETE();
      expect(res.status).toBe(200);
      expect(clearImapConfigMock).toHaveBeenCalledWith("t-1");
      expect(logAuditMock.mock.calls[0][0].action).toBe("mail.imap_config_cleared");
    });
  });
});
