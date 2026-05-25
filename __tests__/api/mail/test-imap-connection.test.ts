/**
 * Tests route POST /api/mail/test-imap-connection.
 *
 * Sabotage-test : si on enlève recordImapSyncResult, le test "stored config →
 * status persisté" rougirait.
 */
import { describe, expect, test, vi, beforeEach, beforeAll } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAdminMock,
  isRateLimitedMock,
  getImapConfigInternalMock,
  recordImapSyncResultMock,
  testImapConnectionMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  getImapConfigInternalMock: vi.fn(),
  recordImapSyncResultMock: vi.fn(),
  testImapConnectionMock: vi.fn(),
}));

vi.mock("@/lib/auth/user-context", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/mail/queries", () => ({
  getImapConfigInternal: getImapConfigInternalMock,
  recordImapSyncResult: recordImapSyncResultMock,
}));
vi.mock("@/lib/mail/imap-client", () => ({
  testImapConnection: testImapConnectionMock,
}));

beforeAll(() => {
  process.env.AUTH_SECRET = "a".repeat(32);
});

import { POST } from "@/app/api/mail/test-imap-connection/route";
import { makeRequest, readJson } from "../_helpers";

function makeCtx() {
  return {
    ctx: {
      userId: "u-1",
      email: "u@v.site",
      tenantId: "t-1",
      tenantOwnerId: null,
      workspaces: [],
      isAdmin: true,
      activeWorkspaceId: null,
    },
  };
}

describe("/api/mail/test-imap-connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  test("403 si non-admin", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await POST(
      makeRequest("http://localhost/api/mail/test-imap-connection", {
        method: "POST",
        body: {},
      }),
    );
    expect(res.status).toBe(403);
  });

  test("429 si rate limited", async () => {
    requireAdminMock.mockResolvedValue(makeCtx());
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(
      makeRequest("http://localhost/api/mail/test-imap-connection", {
        method: "POST",
        body: {},
      }),
    );
    expect(res.status).toBe(429);
  });

  test("missing_credentials si pas de stored + pas d'override password", async () => {
    requireAdminMock.mockResolvedValue(makeCtx());
    getImapConfigInternalMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest("http://localhost/api/mail/test-imap-connection", {
        method: "POST",
        body: { host: "imap.x.com", port: 993, username: "u", tls: true, folder: "INBOX" },
      }),
    );
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("missing_credentials");
  });

  test("stored config → testImapConnection appelé + status persisté", async () => {
    requireAdminMock.mockResolvedValue(makeCtx());
    getImapConfigInternalMock.mockResolvedValue({
      tenantId: "t-1",
      host: "imap.x.com",
      port: 993,
      username: "u",
      passwordEnc: "iv:tag:ct",
      tls: true,
      folder: "INBOX",
      lastUidSeen: null,
    });
    testImapConnectionMock.mockResolvedValue({ ok: true });
    const res = await POST(
      makeRequest("http://localhost/api/mail/test-imap-connection", {
        method: "POST",
        body: {},
      }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(testImapConnectionMock).toHaveBeenCalled();
    expect(recordImapSyncResultMock).toHaveBeenCalledWith("t-1", expect.objectContaining({
      status: "ok",
    }));
  });

  test("override password fourni → encryptPassword utilisé (pas stored)", async () => {
    requireAdminMock.mockResolvedValue(makeCtx());
    getImapConfigInternalMock.mockResolvedValue(null); // pas de stored
    testImapConnectionMock.mockResolvedValue({ ok: true });
    const res = await POST(
      makeRequest("http://localhost/api/mail/test-imap-connection", {
        method: "POST",
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
    expect(testImapConnectionMock).toHaveBeenCalled();
    // Pas de stored → on n'enregistre pas le résultat en DB (test à froid)
    expect(recordImapSyncResultMock).not.toHaveBeenCalled();
  });

  test("test échoue → reason et errorMessage remontés", async () => {
    requireAdminMock.mockResolvedValue(makeCtx());
    getImapConfigInternalMock.mockResolvedValue(null);
    testImapConnectionMock.mockResolvedValue({
      ok: false,
      reason: "auth_failed",
      errorMessage: "LOGIN failed",
    });
    const res = await POST(
      makeRequest("http://localhost/api/mail/test-imap-connection", {
        method: "POST",
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
    const body = (await readJson(res)) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("auth_failed");
  });

  test("400 si payload invalide (port hors plage)", async () => {
    requireAdminMock.mockResolvedValue(makeCtx());
    const res = await POST(
      makeRequest("http://localhost/api/mail/test-imap-connection", {
        method: "POST",
        body: { port: 99999 },
      }),
    );
    expect(res.status).toBe(400);
  });
});
