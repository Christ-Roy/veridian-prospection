/**
 * Tests route /api/mail/send — branche Hub Mail Gateway.
 *
 * Refactor 2026-05-26 : source de vérité = Hub `mail-provider-status` (HMAC)
 * au lieu de la colonne workspace.mail_provider (DROP migration 0035).
 *
 * Couvre :
 *  - Routing : checkHubMailProviderStatus(true) → sendMailViaHub
 *  - Mapping codes erreur Hub (412 needs_reauth, 422 provider_not_linked, etc.)
 *  - Reply-to = email auth user
 *  - Audit log avec provider=gmail-via-hub
 *  - Idempotency key passé tel quel si fourni, sinon généré
 *  - checkHubMailProviderStatus(false) → fallback SMTP (sendMailViaHub PAS appelé)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const {
  requireAuthMock,
  getTenantIdMock,
  getWorkspaceScopeMock,
  isRateLimitedMock,
  prismaMock,
  sendMailViaHubMock,
  checkHubMailProviderStatusMock,
  recordSentEmailMock,
  recordFailedEmailMock,
  logAuditMock,
  freshIdempotencyKeyMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  prismaMock: {
    user: { findUnique: vi.fn() },
  },
  sendMailViaHubMock: vi.fn(),
  checkHubMailProviderStatusMock: vi.fn(),
  recordSentEmailMock: vi.fn(),
  recordFailedEmailMock: vi.fn(),
  logAuditMock: vi.fn(),
  freshIdempotencyKeyMock: vi.fn(() => "33333333-3333-4333-8333-333333333333"),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({ getTenantId: getTenantIdMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
}));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/mail/queries", () => ({
  getMailConfigInternal: vi.fn(),
  recordSentEmail: recordSentEmailMock,
  recordFailedEmail: recordFailedEmailMock,
}));
vi.mock("@/lib/mail/smtp", () => ({ sendMail: vi.fn() }));
vi.mock("@/lib/mail-gateway-client", () => ({
  sendMailViaHub: sendMailViaHubMock,
  checkHubMailProviderStatus: checkHubMailProviderStatusMock,
  freshIdempotencyKey: freshIdempotencyKeyMock,
  deterministicIdempotencyKey: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

import { POST } from "@/app/api/mail/send/route";
import { makeRequest, readJson } from "../_helpers";

const VALID_BODY = {
  to: "alice@acme.com",
  siren: "123456789",
  subject: "Hello",
  bodyText: "Hi Alice",
  bodyHtml: "<p>Hi Alice</p>",
};

const AUTH_USER = { id: "u-1", email: "commercial@veridian.site" };
const HUB_USER_ID = "hub-user-uuid-1234";

function setupHubProvider(opts: { hubUserId?: string | null } = {}) {
  requireAuthMock.mockResolvedValue({ user: AUTH_USER });
  getTenantIdMock.mockResolvedValue("t-1");
  getWorkspaceScopeMock.mockResolvedValue({
    filter: null,
    insertId: "ws-1",
    userFilter: null,
    ctx: null,
  });
  prismaMock.user.findUnique.mockResolvedValue({
    hubUserId: opts.hubUserId === undefined ? HUB_USER_ID : opts.hubUserId,
    email: AUTH_USER.email,
    name: "Commercial Test",
  });
  checkHubMailProviderStatusMock.mockResolvedValue(true);
}

describe("POST /api/mail/send — branche gmail-via-hub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
    freshIdempotencyKeyMock.mockReturnValue("33333333-3333-4333-8333-333333333333");
  });

  test("happy path : Gmail OAuth lié via Hub → sendMailViaHub appelé avec hubUserId", async () => {
    setupHubProvider();
    sendMailViaHubMock.mockResolvedValue({
      ok: true,
      messageId: "<msg-hub@gmail.com>",
      sentAt: new Date("2026-05-25T12:00:00Z"),
      idempotentReplay: false,
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      ok: boolean;
      messageId: string;
      provider: string;
    };
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe("<msg-hub@gmail.com>");
    expect(body.provider).toBe("gmail-via-hub");

    expect(sendMailViaHubMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: HUB_USER_ID,
        to: "alice@acme.com",
        subject: "Hello",
        bodyText: "Hi Alice",
        bodyHtml: "<p>Hi Alice</p>",
        replyTo: AUTH_USER.email,
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      }),
    );

    expect(recordSentEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "<msg-hub@gmail.com>",
        fromEmail: AUTH_USER.email,
      }),
    );
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mail.sent",
        metadata: expect.objectContaining({ provider: "gmail-via-hub" }),
      }),
    );
  });

  test("idempotencyKey du payload utilisé tel quel si fourni", async () => {
    setupHubProvider();
    sendMailViaHubMock.mockResolvedValue({
      ok: true,
      messageId: "<msg-1@h>",
      sentAt: new Date(),
      idempotentReplay: false,
    });

    const CUSTOM_KEY = "44444444-4444-4444-8444-444444444444";
    await POST(
      makeRequest("/api/mail/send", {
        method: "POST",
        body: { ...VALID_BODY, idempotencyKey: CUSTOM_KEY },
      }),
    );
    expect(sendMailViaHubMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: CUSTOM_KEY }),
    );
    expect(freshIdempotencyKeyMock).not.toHaveBeenCalled();
  });

  test("412 needs_reauth si Hub retourne needs_reauth", async () => {
    setupHubProvider();
    sendMailViaHubMock.mockResolvedValue({
      ok: false,
      reason: "needs_reauth",
      httpStatus: 412,
      message: "refresh token revoked",
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(412);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("needs_reauth");
    expect(recordFailedEmailMock).toHaveBeenCalled();
  });

  test("422 provider_not_linked si Hub retourne provider_not_linked", async () => {
    setupHubProvider();
    sendMailViaHubMock.mockResolvedValue({
      ok: false,
      reason: "provider_not_linked",
      httpStatus: 422,
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(422);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("provider_not_linked");
  });

  test("429 rate_limit si Hub renvoie rate_limit", async () => {
    setupHubProvider();
    sendMailViaHubMock.mockResolvedValue({
      ok: false,
      reason: "rate_limit",
      httpStatus: 429,
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(429);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("rate_limit");
  });

  test("502 provider_unreachable si Hub timeout réseau", async () => {
    setupHubProvider();
    sendMailViaHubMock.mockResolvedValue({
      ok: false,
      reason: "hub_timeout",
      httpStatus: 0,
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(502);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("provider_unreachable");
  });

  test("503 hub_misconfigured si Hub HMAC invalide (deploy cassé)", async () => {
    setupHubProvider();
    sendMailViaHubMock.mockResolvedValue({
      ok: false,
      reason: "hub_misconfigured",
      httpStatus: 0,
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(503);
  });

  test("404 user_not_found si Hub ne reconnaît pas hub_user_id", async () => {
    setupHubProvider();
    sendMailViaHubMock.mockResolvedValue({
      ok: false,
      reason: "user_not_found",
      httpStatus: 404,
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(404);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("user_not_found");
  });

  test("Hub status linked=false → branche SMTP, sendMailViaHub PAS appelé", async () => {
    requireAuthMock.mockResolvedValue({ user: AUTH_USER });
    getTenantIdMock.mockResolvedValue("t-1");
    getWorkspaceScopeMock.mockResolvedValue({
      filter: null,
      insertId: "ws-1",
      userFilter: null,
      ctx: null,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      hubUserId: HUB_USER_ID,
      email: AUTH_USER.email,
      name: "Commercial Test",
    });
    checkHubMailProviderStatusMock.mockResolvedValue(false);

    // Pas de SMTP config non plus → 412 missing_credentials (branche SMTP existant)
    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(412);
    expect(sendMailViaHubMock).not.toHaveBeenCalled();
  });

  test("hubUserId null → branche SMTP (pas de check Hub status nécessaire)", async () => {
    requireAuthMock.mockResolvedValue({ user: AUTH_USER });
    getTenantIdMock.mockResolvedValue("t-1");
    getWorkspaceScopeMock.mockResolvedValue({
      filter: null,
      insertId: "ws-1",
      userFilter: null,
      ctx: null,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      hubUserId: null,
      email: AUTH_USER.email,
      name: "Legacy user",
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_BODY }),
    );
    // Tombe sur la branche SMTP → 412 missing_credentials
    expect(res.status).toBe(412);
    expect(sendMailViaHubMock).not.toHaveBeenCalled();
    expect(checkHubMailProviderStatusMock).not.toHaveBeenCalled();
  });

  test("idempotent_replay=true propagé dans la réponse", async () => {
    setupHubProvider();
    sendMailViaHubMock.mockResolvedValue({
      ok: true,
      messageId: "<replay@h>",
      sentAt: new Date(),
      idempotentReplay: true,
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_BODY }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      ok: boolean;
      idempotentReplay: boolean;
    };
    expect(body.idempotentReplay).toBe(true);
  });
});
