/**
 * Tests route /api/mail/signature — GET + PUT.
 *
 * Couvre :
 *  - 401 si non auth
 *  - 404 si tenant introuvable
 *  - 429 si rate limited (PUT)
 *  - 400 si payload invalide
 *  - GET retourne {mailSignatureHtml, mailSignatureEnabled} ou défauts si pas de config
 *  - PUT 200 + maj + logAudit "mail.signature_updated"
 *  - PUT 500 si DB throw
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  isRateLimitedMock,
  getMailConfigPublicMock,
  updateMailSignatureMock,
  logAuditMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  getMailConfigPublicMock: vi.fn(),
  updateMailSignatureMock: vi.fn(),
  logAuditMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/mail/queries", () => ({
  getMailConfigPublic: getMailConfigPublicMock,
  updateMailSignature: updateMailSignatureMock,
}));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

import { GET, PUT } from "@/app/api/mail/signature/route";
import { makeRequest, readJson } from "../_helpers";

beforeEach(() => {
  vi.clearAllMocks();
  isRateLimitedMock.mockReturnValue(false);
});

describe("GET /api/mail/signature", () => {
  test("401 si non auth", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("404 si tenant introuvable", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  test("200 + valeurs depuis tenant_mail_config", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigPublicMock.mockResolvedValue({
      mailSignatureHtml: "<p>Sig</p>",
      mailSignatureEnabled: true,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      mailSignatureHtml: string | null;
      mailSignatureEnabled: boolean;
    };
    expect(body.mailSignatureHtml).toBe("<p>Sig</p>");
    expect(body.mailSignatureEnabled).toBe(true);
  });

  test("200 + défauts (null, true) si pas de config existante", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigPublicMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      mailSignatureHtml: string | null;
      mailSignatureEnabled: boolean;
    };
    expect(body.mailSignatureHtml).toBeNull();
    expect(body.mailSignatureEnabled).toBe(true);
  });
});

describe("PUT /api/mail/signature", () => {
  const VALID_BODY = {
    mailSignatureHtml: "<p>Robert</p>",
    mailSignatureEnabled: true,
  };

  test("401 si non auth", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await PUT(
      makeRequest("/api/mail/signature", { method: "PUT", body: VALID_BODY }),
    );
    expect(res.status).toBe(401);
  });

  test("429 si rate limited", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    isRateLimitedMock.mockReturnValue(true);
    const res = await PUT(
      makeRequest("/api/mail/signature", { method: "PUT", body: VALID_BODY }),
    );
    expect(res.status).toBe(429);
  });

  test("404 si tenant introuvable", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue(null);
    const res = await PUT(
      makeRequest("/api/mail/signature", { method: "PUT", body: VALID_BODY }),
    );
    expect(res.status).toBe(404);
  });

  test("400 si payload invalide (enabled manquant)", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    const res = await PUT(
      makeRequest("/api/mail/signature", {
        method: "PUT",
        body: { mailSignatureHtml: "<p>x</p>" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("200 + maj + logAudit + bytes envoyés", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    updateMailSignatureMock.mockResolvedValue({
      mailSignatureHtml: "<p>Robert</p>",
      mailSignatureEnabled: true,
    });
    const res = await PUT(
      makeRequest("/api/mail/signature", { method: "PUT", body: VALID_BODY }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as { mailSignatureHtml: string };
    expect(body.mailSignatureHtml).toBe("<p>Robert</p>");
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mail.signature_updated",
        metadata: expect.objectContaining({
          enabled: true,
          htmlLength: "<p>Robert</p>".length,
        }),
      }),
    );
  });

  test("500 si DB throw", async () => {
    requireAuthMock.mockResolvedValue({ user: { id: "u-1", email: "u@v.site" } });
    getTenantIdMock.mockResolvedValue("t-1");
    updateMailSignatureMock.mockRejectedValue(new Error("DB down"));
    const res = await PUT(
      makeRequest("/api/mail/signature", { method: "PUT", body: VALID_BODY }),
    );
    expect(res.status).toBe(500);
  });
});
