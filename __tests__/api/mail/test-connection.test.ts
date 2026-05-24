/**
 * Tests route /api/mail/test-connection — POST.
 */
import { describe, expect, test, vi, beforeEach, beforeAll } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  isRateLimitedMock,
  getMailConfigInternalMock,
  recordTestResultMock,
  testConnectionMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  getMailConfigInternalMock: vi.fn(),
  recordTestResultMock: vi.fn(),
  testConnectionMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/mail/queries", () => ({
  getMailConfigInternal: getMailConfigInternalMock,
  recordTestResult: recordTestResultMock,
}));
vi.mock("@/lib/mail/smtp", () => ({ testConnection: testConnectionMock }));

beforeAll(() => {
  process.env.AUTH_SECRET = "a".repeat(32);
});

import { POST } from "@/app/api/mail/test-connection/route";
import { makeRequest, readJson } from "../_helpers";

describe("POST /api/mail/test-connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  test("401 si non auth", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/mail/test-connection", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(401);
  });

  test("429 si rate limited", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(
      makeRequest("/api/mail/test-connection", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(429);
  });

  test("retourne missing_credentials si rien en DB et pas d'override", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest("/api/mail/test-connection", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("missing_credentials");
  });

  test("appelle testConnection avec creds DB et persiste résultat", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue({
      host: "h",
      port: 587,
      username: "u",
      passwordEnc: "enc",
      tls: true,
      fromEmail: "f@x.com",
      fromName: null,
    });
    testConnectionMock.mockResolvedValue({ ok: true });
    const res = await POST(
      makeRequest("/api/mail/test-connection", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(200);
    expect(testConnectionMock).toHaveBeenCalled();
    expect(recordTestResultMock).toHaveBeenCalledWith("t-1", "ok", null);
  });

  test("persiste reason en cas d'échec", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue({
      host: "h",
      port: 587,
      username: "u",
      passwordEnc: "enc",
      tls: true,
      fromEmail: "f@x.com",
      fromName: null,
    });
    testConnectionMock.mockResolvedValue({
      ok: false,
      reason: "auth_failed",
      errorMessage: "535",
    });
    await POST(
      makeRequest("/api/mail/test-connection", { method: "POST", body: {} }),
    );
    expect(recordTestResultMock).toHaveBeenCalledWith("t-1", "auth_failed", "535");
  });

  test("supporte override de password (test avant save)", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(null);
    testConnectionMock.mockResolvedValue({ ok: true });
    const res = await POST(
      makeRequest("/api/mail/test-connection", {
        method: "POST",
        body: {
          host: "h",
          port: 587,
          username: "u",
          password: "pw",
          tls: true,
          fromEmail: "f@x.com",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(testConnectionMock).toHaveBeenCalled();
    // Pas de DB → pas de recordTestResult
    expect(recordTestResultMock).not.toHaveBeenCalled();
  });
});
