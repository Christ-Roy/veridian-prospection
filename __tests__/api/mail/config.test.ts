/**
 * Tests routes /api/mail/config — GET + PUT.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  isRateLimitedMock,
  logAuditMock,
  getMailConfigPublicMock,
  upsertMailConfigMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  logAuditMock: vi.fn(),
  getMailConfigPublicMock: vi.fn(),
  upsertMailConfigMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/mail/queries", () => ({
  getMailConfigPublic: getMailConfigPublicMock,
  upsertMailConfig: upsertMailConfigMock,
}));

import { GET, PUT } from "@/app/api/mail/config/route";
import { makeRequest, readJson } from "../_helpers";

describe("/api/mail/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  describe("GET", () => {
    test("401 si non auth", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await GET();
      expect(res.status).toBe(401);
    });

    test("404 si pas de tenant", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(404);
    });

    test("retourne la config publique (sans password)", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      getMailConfigPublicMock.mockResolvedValue({
        host: "smtp.x.com",
        port: 587,
        username: "u",
        tls: true,
        fromEmail: "f@x.com",
        fromName: null,
        passwordConfigured: true,
        lastTestAt: null,
        lastTestStatus: "ok",
        lastTestError: null,
      });
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body.passwordConfigured).toBe(true);
      expect(body).not.toHaveProperty("password");
      expect(body).not.toHaveProperty("smtpPasswordEnc");
    });

    test("retourne config vide par défaut si jamais configurée", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      getMailConfigPublicMock.mockResolvedValue(null);
      const res = await GET();
      const body = (await readJson(res)) as Record<string, unknown>;
      expect(body.passwordConfigured).toBe(false);
    });
  });

  describe("PUT", () => {
    test("401 si non auth", async () => {
      requireAuthMock.mockResolvedValue({
        error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });
      const res = await PUT(makeRequest("/api/mail/config", { method: "PUT", body: {} }));
      expect(res.status).toBe(401);
    });

    test("429 si rate limited", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      isRateLimitedMock.mockReturnValue(true);
      const res = await PUT(makeRequest("/api/mail/config", { method: "PUT", body: {} }));
      expect(res.status).toBe(429);
    });

    test("400 sur payload invalide", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      const res = await PUT(
        makeRequest("/api/mail/config", {
          method: "PUT",
          body: { host: "x", port: "bad" },
        }),
      );
      expect(res.status).toBe(400);
    });

    test("200 sur upsert valide + appel logAudit", async () => {
      requireAuthMock.mockResolvedValue({
        user: { id: "u-1", email: "u@v.site" },
      });
      getTenantIdMock.mockResolvedValue("t-1");
      upsertMailConfigMock.mockResolvedValue({
        host: "smtp.x.com",
        port: 587,
        username: "u",
        tls: true,
        fromEmail: "f@x.com",
        fromName: null,
        passwordConfigured: true,
        lastTestAt: null,
        lastTestStatus: null,
        lastTestError: null,
      });
      const res = await PUT(
        makeRequest("/api/mail/config", {
          method: "PUT",
          body: {
            host: "smtp.x.com",
            port: 587,
            username: "u",
            password: "hunter2",
            tls: true,
            fromEmail: "f@x.com",
            fromName: null,
          },
        }),
      );
      expect(res.status).toBe(200);
      expect(upsertMailConfigMock).toHaveBeenCalledWith(
        "t-1",
        expect.objectContaining({ host: "smtp.x.com", password: "hunter2" }),
      );
      expect(logAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: "mail.config_updated" }),
      );
    });
  });
});
