/**
 * Tests route /api/mail/send — POST.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getWorkspaceScopeMock,
  isRateLimitedMock,
  getMailConfigInternalMock,
  recordSentEmailMock,
  recordFailedEmailMock,
  sendMailMock,
  logAuditMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  getMailConfigInternalMock: vi.fn(),
  recordSentEmailMock: vi.fn(),
  recordFailedEmailMock: vi.fn(),
  sendMailMock: vi.fn(),
  logAuditMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/mail/queries", () => ({
  getMailConfigInternal: getMailConfigInternalMock,
  recordSentEmail: recordSentEmailMock,
  recordFailedEmail: recordFailedEmailMock,
}));
vi.mock("@/lib/mail/smtp", () => ({ sendMail: sendMailMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

import { POST } from "@/app/api/mail/send/route";
import { makeRequest, readJson } from "../_helpers";

const VALID_FREEFORM_BODY = {
  to: "alice@acme.com",
  siren: "123456789",
  subject: "Hello",
  bodyText: "Hi Alice",
  bodyHtml: "<p>Hi Alice</p>",
};

const VALID_TEMPLATE_BODY = {
  to: "alice@acme.com",
  siren: "123456789",
  templateSlug: "relance-commerciale-v1",
  vars: { prospect: { name: "Alice", entreprise: "Acme SAS" } },
};

const VALID_CREDS = {
  host: "smtp.x.com",
  port: 587,
  username: "u",
  passwordEnc: "enc",
  tls: true,
  fromEmail: "f@x.com",
  fromName: "Robert",
};

describe("POST /api/mail/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
    getWorkspaceScopeMock.mockResolvedValue({ filter: null, insertId: "ws-1" });
  });

  test("401 si non auth", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_FREEFORM_BODY }),
    );
    expect(res.status).toBe(401);
  });

  test("429 si rate limited", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    isRateLimitedMock.mockReturnValue(true);
    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_FREEFORM_BODY }),
    );
    expect(res.status).toBe(429);
  });

  test("400 sur payload invalide (template sans vars)", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    const res = await POST(
      makeRequest("/api/mail/send", {
        method: "POST",
        body: { to: "a@b.c", templateSlug: "relance-commerciale-v1" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("400 sur payload invalide (ni template ni body)", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    const res = await POST(
      makeRequest("/api/mail/send", {
        method: "POST",
        body: { to: "a@b.c" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("412 si SMTP pas configuré", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_FREEFORM_BODY }),
    );
    expect(res.status).toBe(412);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("missing_credentials");
  });

  test("400 sur templateSlug inconnu", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(VALID_CREDS);
    const res = await POST(
      makeRequest("/api/mail/send", {
        method: "POST",
        body: { ...VALID_TEMPLATE_BODY, templateSlug: "inexistant" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("send freeform → 200 ok + recordSentEmail + logAudit", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(VALID_CREDS);
    sendMailMock.mockResolvedValue({ ok: true, messageId: "<msg-1@h>" });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_FREEFORM_BODY }),
    );
    expect(res.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledWith(
      VALID_CREDS,
      expect.objectContaining({
        to: "alice@acme.com",
        subject: "Hello",
      }),
    );
    expect(recordSentEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        siren: "123456789",
        messageId: "<msg-1@h>",
        templateSlug: null,
      }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mail.sent" }),
    );
  });

  test("send template → variables rendues dans subject/body", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(VALID_CREDS);
    sendMailMock.mockResolvedValue({ ok: true, messageId: "<msg-2@h>" });

    await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_TEMPLATE_BODY }),
    );
    const sendArgs = sendMailMock.mock.calls[0]![1];
    expect(sendArgs.subject).toContain("Acme SAS");
    expect(sendArgs.bodyText).toContain("Alice");
    expect(sendArgs.bodyText).not.toMatch(/\{\{/);
    expect(recordSentEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ templateSlug: "relance-commerciale-v1" }),
    );
  });

  test("send échec → 502 + recordFailedEmail", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(VALID_CREDS);
    sendMailMock.mockResolvedValue({
      ok: false,
      reason: "auth_failed",
      errorMessage: "535",
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_FREEFORM_BODY }),
    );
    expect(res.status).toBe(502);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("auth_failed");
    expect(recordFailedEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: "535" }),
    );
    expect(recordSentEmailMock).not.toHaveBeenCalled();
  });
});
