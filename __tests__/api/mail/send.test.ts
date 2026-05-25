/**
 * Tests route /api/mail/send — POST.
 *
 * Refactor v2 (2026-05-25, ticket follow-ups §F) :
 * /api/mail/send INSERT mail_outbox (queue d'envoi) au lieu d'appeler
 * sendMail sync. Le contract HTTP est passé de 200 (sent) à 202 (queued)
 * pour le path SMTP BYO. Path Hub Gateway reste sync (200/4xx/5xx).
 *
 * Couvre :
 *  - Auth + rate limit + payload invalide
 *  - 412 si SMTP non configuré
 *  - 400 sur templateSlug inconnu (custom OR fallback)
 *  - 202 queued (freeform) : enqueueMail appelé + logAudit "mail.queued"
 *  - 202 queued (template) : variables rendues dans subject/body au payload
 *  - 500 si enqueue throw (DB indisponible)
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getWorkspaceScopeMock,
  isRateLimitedMock,
  getMailConfigInternalMock,
  recordFailedEmailMock,
  resolveTemplateMock,
  enqueueMailMock,
  prismaTransactionMock,
  logAuditMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  isRateLimitedMock: vi.fn(() => false),
  getMailConfigInternalMock: vi.fn(),
  recordFailedEmailMock: vi.fn(),
  resolveTemplateMock: vi.fn(),
  enqueueMailMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
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
  recordSentEmail: vi.fn(),
  recordFailedEmail: recordFailedEmailMock,
}));
vi.mock("@/lib/mail/tenant-templates", () => ({
  resolveTemplate: resolveTemplateMock,
}));
vi.mock("@/lib/mail/outbox", () => ({
  enqueueMail: enqueueMailMock,
}));
const { userFindUniqueMock, workspaceFindUniqueMock, sendMailViaHubMock } = vi.hoisted(
  () => ({
    userFindUniqueMock: vi.fn(),
    workspaceFindUniqueMock: vi.fn(),
    sendMailViaHubMock: vi.fn(),
  }),
);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (cb: (tx: unknown) => unknown) => prismaTransactionMock(cb),
    user: { findUnique: userFindUniqueMock },
    workspace: { findUnique: workspaceFindUniqueMock },
  },
}));
vi.mock("@/lib/mail-gateway-client", () => ({
  sendMailViaHub: sendMailViaHubMock,
  freshIdempotencyKey: () => "00000000-0000-4000-8000-000000000abc",
}));
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

const SAMPLE_TEMPLATE = {
  slug: "relance-commerciale-v1",
  label: "Relance",
  subject: "Suite à notre échange — {{ prospect.entreprise }}",
  bodyText: "Bonjour {{ prospect.name }} ({{ prospect.entreprise }})",
  bodyHtml: "<p>Bonjour {{ prospect.name }} ({{ prospect.entreprise }})</p>",
};

describe("POST /api/mail/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
    getWorkspaceScopeMock.mockResolvedValue({ filter: null, insertId: "ws-1" });
    // Default : execute tx callback in place avec un stub minimal.
    prismaTransactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({}),
    );
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
    expect(enqueueMailMock).not.toHaveBeenCalled();
  });

  test("400 sur templateSlug inconnu", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(VALID_CREDS);
    resolveTemplateMock.mockResolvedValue(null);
    const res = await POST(
      makeRequest("/api/mail/send", {
        method: "POST",
        body: { ...VALID_TEMPLATE_BODY, templateSlug: "inexistant" },
      }),
    );
    expect(res.status).toBe(400);
    expect(enqueueMailMock).not.toHaveBeenCalled();
  });

  test("send freeform → 202 queued + enqueueMail + logAudit mail.queued", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(VALID_CREDS);
    enqueueMailMock.mockResolvedValue({
      outboxId: "out-1",
      leadEmailId: "lead-1",
      idempotencyKey: "key-1",
      alreadyEnqueued: false,
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_FREEFORM_BODY }),
    );
    expect(res.status).toBe(202);
    const body = (await readJson(res)) as {
      ok: boolean;
      status: string;
      outboxId: string;
      leadEmailId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("queued");
    expect(body.outboxId).toBe("out-1");
    expect(enqueueMailMock).toHaveBeenCalledOnce();
    const [, enqueueArgs] = enqueueMailMock.mock.calls[0]!;
    expect(enqueueArgs.tenantId).toBe("t-1");
    expect(enqueueArgs.payload.to).toBe("alice@acme.com");
    expect(enqueueArgs.payload.subject).toBe("Hello");
    expect(enqueueArgs.payload.siren).toBe("123456789");
    expect(enqueueArgs.payload.provider).toBe("smtp");
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mail.queued" }),
    );
  });

  test("send template → variables rendues dans subject/body au payload", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(VALID_CREDS);
    resolveTemplateMock.mockResolvedValue(SAMPLE_TEMPLATE);
    enqueueMailMock.mockResolvedValue({
      outboxId: "out-2",
      leadEmailId: "lead-2",
      idempotencyKey: "key-2",
      alreadyEnqueued: false,
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_TEMPLATE_BODY }),
    );
    expect(res.status).toBe(202);

    const [, enqueueArgs] = enqueueMailMock.mock.calls[0]!;
    expect(enqueueArgs.payload.subject).toContain("Acme SAS");
    expect(enqueueArgs.payload.bodyText).toContain("Alice");
    expect(enqueueArgs.payload.bodyText).toContain("Acme SAS");
    expect(enqueueArgs.payload.bodyText).not.toMatch(/\{\{/);
    expect(enqueueArgs.payload.templateSlug).toBe("relance-commerciale-v1");
  });

  test("alreadyEnqueued true → réponse 202 alreadyEnqueued=true (idempotence Stripe-like)", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(VALID_CREDS);
    enqueueMailMock.mockResolvedValue({
      outboxId: "out-1",
      leadEmailId: "lead-1",
      idempotencyKey: "key-replay",
      alreadyEnqueued: true,
    });

    const res = await POST(
      makeRequest("/api/mail/send", {
        method: "POST",
        body: { ...VALID_FREEFORM_BODY, idempotencyKey: "00000000-0000-4000-8000-000000000001" },
      }),
    );
    expect(res.status).toBe(202);
    const body = (await readJson(res)) as { alreadyEnqueued: boolean };
    expect(body.alreadyEnqueued).toBe(true);
  });

  test("500 + recordFailedEmail si enqueue throw (DB indisponible)", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    getMailConfigInternalMock.mockResolvedValue(VALID_CREDS);
    recordFailedEmailMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockRejectedValue(new Error("DB connection lost"));

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_FREEFORM_BODY }),
    );
    expect(res.status).toBe(500);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("enqueue_failed");
    expect(recordFailedEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining("enqueue_failed"),
      }),
    );
  });

  // ─── Branche Hub Gateway (gmail-via-hub) ───────────────────────────────
  // Exerce sendViaHubGateway + mapHubFailureToHttp pour garantir que le
  // sabotage du fichier route.ts est détecté (la branche SMTP seule ne
  // couvrait pas mapHubFailureToHttp → fonction sabotable en silence).

  test("Hub Gateway provider_not_linked (pas de hubUserId) → 422", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    workspaceFindUniqueMock.mockResolvedValue({
      mailProvider: "gmail-via-hub",
      gmailConnectedAt: new Date(),
    });
    userFindUniqueMock.mockResolvedValue({
      hubUserId: null,
      email: "u@v.site",
      name: "U",
    });

    const res = await POST(
      makeRequest("/api/mail/send", {
        method: "POST",
        body: { ...VALID_FREEFORM_BODY, idempotencyKey: undefined },
      }),
    );
    expect(res.status).toBe(422);
    const body = (await readJson(res)) as { reason: string; provider?: string };
    expect(body.reason).toBe("provider_not_linked");
  });

  test("Hub Gateway send OK → 200 ok + messageId + provider=gmail-via-hub", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    workspaceFindUniqueMock.mockResolvedValue({
      mailProvider: "gmail-via-hub",
      gmailConnectedAt: new Date(),
    });
    userFindUniqueMock.mockResolvedValue({
      hubUserId: "00000000-0000-4000-8000-deadbeefcafe",
      email: "u@v.site",
      name: "Robert",
    });
    sendMailViaHubMock.mockResolvedValue({
      ok: true,
      messageId: "<hub-msg-1@gmail>",
      idempotentReplay: false,
    });

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_FREEFORM_BODY }),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      ok: boolean;
      messageId: string;
      provider: string;
    };
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe("<hub-msg-1@gmail>");
    expect(body.provider).toBe("gmail-via-hub");
    expect(sendMailViaHubMock).toHaveBeenCalledOnce();
  });

  test("Hub Gateway fail needs_reauth → 412 (mapHubFailureToHttp)", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    workspaceFindUniqueMock.mockResolvedValue({
      mailProvider: "gmail-via-hub",
      gmailConnectedAt: new Date(),
    });
    userFindUniqueMock.mockResolvedValue({
      hubUserId: "00000000-0000-4000-8000-deadbeefcafe",
      email: "u@v.site",
      name: "Robert",
    });
    sendMailViaHubMock.mockResolvedValue({
      ok: false,
      reason: "needs_reauth",
      httpStatus: 412,
      message: "Token expiré",
    });
    recordFailedEmailMock.mockResolvedValue(undefined);

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_FREEFORM_BODY }),
    );
    // mapHubFailureToHttp("needs_reauth") → status 412
    expect(res.status).toBe(412);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("needs_reauth");
  });

  test("Hub Gateway fail provider_unreachable → 502 (mapHubFailureToHttp)", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getTenantIdMock.mockResolvedValue("t-1");
    workspaceFindUniqueMock.mockResolvedValue({
      mailProvider: "gmail-via-hub",
      gmailConnectedAt: new Date(),
    });
    userFindUniqueMock.mockResolvedValue({
      hubUserId: "00000000-0000-4000-8000-deadbeefcafe",
      email: "u@v.site",
      name: "Robert",
    });
    sendMailViaHubMock.mockResolvedValue({
      ok: false,
      reason: "hub_timeout",
      httpStatus: 504,
      message: "Hub timed out",
    });
    recordFailedEmailMock.mockResolvedValue(undefined);

    const res = await POST(
      makeRequest("/api/mail/send", { method: "POST", body: VALID_FREEFORM_BODY }),
    );
    // mapHubFailureToHttp("hub_timeout") → status 502 reason "provider_unreachable"
    expect(res.status).toBe(502);
    const body = (await readJson(res)) as { reason: string };
    expect(body.reason).toBe("provider_unreachable");
  });
});
