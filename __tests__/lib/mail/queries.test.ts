/**
 * Tests des queries mail — Prisma mocké.
 */
import { describe, expect, test, vi, beforeEach, beforeAll } from "vitest";

const findUniqueMock = vi.hoisted(() => vi.fn());
const upsertMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => vi.fn());
const findManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenantMailConfig: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
      update: updateMock,
      findMany: findManyMock,
    },
    leadEmail: {
      create: createMock,
      findMany: findManyMock,
    },
  },
}));

beforeAll(() => {
  process.env.AUTH_SECRET = "a".repeat(32);
});

import {
  getMailConfigPublic,
  getMailConfigInternal,
  upsertMailConfig,
  recordTestResult,
  recordSentEmail,
  recordFailedEmail,
  listLeadEmails,
  updateMailSignature,
} from "@/lib/mail/queries";
import { encryptPassword } from "@/lib/crypto/encrypt-password";

beforeEach(() => {
  findUniqueMock.mockReset();
  upsertMock.mockReset();
  updateMock.mockReset();
  createMock.mockReset();
  findManyMock.mockReset();
});

describe("getMailConfigPublic", () => {
  test("retourne null si pas de row", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await getMailConfigPublic("t-1")).toBeNull();
  });

  test("masque le password (passwordConfigured true)", async () => {
    findUniqueMock.mockResolvedValue({
      smtpHost: "smtp.x.com",
      smtpPort: 587,
      smtpUsername: "u",
      smtpPasswordEnc: "ciphertext",
      smtpTls: true,
      smtpFromEmail: "from@x.com",
      smtpFromName: "Robert",
      lastTestAt: new Date("2026-05-24T10:00:00Z"),
      lastTestStatus: "ok",
      lastTestError: null,
    });
    const cfg = await getMailConfigPublic("t-1");
    expect(cfg).toMatchObject({
      host: "smtp.x.com",
      port: 587,
      username: "u",
      passwordConfigured: true,
      lastTestStatus: "ok",
    });
    expect(cfg).not.toHaveProperty("password");
    expect(cfg).not.toHaveProperty("smtpPasswordEnc");
  });
});

describe("getMailConfigInternal", () => {
  test("retourne null si config incomplète (pas de host)", async () => {
    findUniqueMock.mockResolvedValue({
      smtpHost: null,
      smtpPort: 587,
      smtpUsername: "u",
      smtpPasswordEnc: "x",
      smtpFromEmail: "f@x.com",
      smtpTls: true,
      smtpFromName: null,
    });
    expect(await getMailConfigInternal("t-1")).toBeNull();
  });

  test("retourne la config complète", async () => {
    findUniqueMock.mockResolvedValue({
      smtpHost: "h",
      smtpPort: 587,
      smtpUsername: "u",
      smtpPasswordEnc: "x",
      smtpFromEmail: "f@x.com",
      smtpTls: true,
      smtpFromName: "Bob",
    });
    expect(await getMailConfigInternal("t-1")).toMatchObject({
      host: "h",
      passwordEnc: "x",
      fromName: "Bob",
    });
  });
});

describe("upsertMailConfig", () => {
  test("chiffre le password avant insert", async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue({
      smtpHost: "h",
      smtpPort: 587,
      smtpUsername: "u",
      smtpPasswordEnc: "encrypted-value",
      smtpTls: true,
      smtpFromEmail: "f@x.com",
      smtpFromName: null,
      lastTestAt: null,
      lastTestStatus: null,
      lastTestError: null,
    });
    await upsertMailConfig("t-1", {
      host: "h",
      port: 587,
      username: "u",
      password: "plaintext",
      tls: true,
      fromEmail: "f@x.com",
      fromName: null,
    });
    const callArgs = upsertMock.mock.calls[0]![0];
    expect(callArgs.create.smtpPasswordEnc).not.toBe("plaintext");
    expect(callArgs.create.smtpPasswordEnc).toContain(":");
    expect(callArgs.update.smtpPasswordEnc).not.toBe("plaintext");
  });

  test("ne touche pas le password si non fourni (rotation hors password)", async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue({
      smtpHost: "h",
      smtpPort: 587,
      smtpUsername: "u",
      smtpPasswordEnc: null,
      smtpTls: true,
      smtpFromEmail: "f@x.com",
      smtpFromName: null,
      lastTestAt: null,
      lastTestStatus: null,
      lastTestError: null,
    });
    await upsertMailConfig("t-1", {
      host: "h",
      port: 587,
      username: "u",
      tls: true,
      fromEmail: "f@x.com",
      fromName: null,
    });
    const callArgs = upsertMock.mock.calls[0]![0];
    expect(callArgs.update.smtpPasswordEnc).toBeUndefined();
  });
});

describe("recordTestResult", () => {
  test("update la row avec status + error", async () => {
    updateMock.mockResolvedValue({});
    await recordTestResult("t-1", "auth_failed", "535");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "t-1" },
        data: expect.objectContaining({
          lastTestStatus: "auth_failed",
          lastTestError: "535",
        }),
      }),
    );
  });
});

describe("recordSentEmail", () => {
  test("crée une row direction=outgoing status=sent", async () => {
    createMock.mockResolvedValue({});
    await recordSentEmail({
      tenantId: "t-1",
      workspaceId: "w-1",
      userId: "u-1",
      siren: "123456789",
      messageId: "<m@h>",
      fromEmail: "from@x.com",
      fromName: "Bob",
      toEmails: ["to@x.com"],
      ccEmails: [],
      subject: "hi",
      bodyText: "t",
      bodyHtml: "<p>t</p>",
      templateSlug: "relance-commerciale-v1",
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: "outgoing",
          sentStatus: "sent",
          siren: "123456789",
          messageId: "<m@h>",
        }),
      }),
    );
  });
});

describe("recordFailedEmail", () => {
  test("crée une row status=failed avec sentError", async () => {
    createMock.mockResolvedValue({});
    await recordFailedEmail({
      tenantId: "t-1",
      workspaceId: null,
      userId: null,
      siren: null,
      messageId: "failed-uuid",
      fromEmail: "f@x.com",
      fromName: null,
      toEmails: ["to@x.com"],
      ccEmails: [],
      subject: "s",
      bodyText: "t",
      bodyHtml: "<p>t</p>",
      templateSlug: null,
      errorMessage: "auth 535",
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sentStatus: "failed",
          sentError: "auth 535",
        }),
      }),
    );
  });
});

describe("listLeadEmails", () => {
  test("retourne les mails d'un prospect, triés desc, default limit 50", async () => {
    findManyMock.mockResolvedValue([]);
    await listLeadEmails("t-1", "123456789");
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "t-1", siren: "123456789" },
        orderBy: { sentAt: "desc" },
        take: 50,
      }),
    );
  });
});

// Le import de encryptPassword est conservé pour s'assurer que le module
// reste branché (sabotage-test : si on retire encryptPassword de upsertMailConfig,
// le test "chiffre le password" rougit).
void encryptPassword;

// ─── IMAP réception v2 (W8b 2026-05-25) ─────────────────────────────────────
import {
  getImapConfigPublic,
  getImapConfigInternal,
  listImapEnabledTenants,
  upsertImapConfig,
  clearImapConfig,
  recordImapSyncResult,
  recordIncomingEmail,
} from "@/lib/mail/queries";

describe("getImapConfigPublic", () => {
  test("retourne null si pas de row", async () => {
    findUniqueMock.mockResolvedValue(null);
    const r = await getImapConfigPublic("t-1");
    expect(r).toBeNull();
  });

  test("masque le password, expose passwordConfigured", async () => {
    findUniqueMock.mockResolvedValue({
      imapHost: "imap.x.com",
      imapPort: 993,
      imapUsername: "u",
      imapPasswordEnc: "iv:tag:ct",
      imapTls: true,
      imapFolder: "INBOX",
      imapLastUidSeen: 42,
      imapLastSyncAt: new Date("2026-05-25T10:00:00Z"),
      imapLastSyncStatus: "ok",
      imapLastSyncError: null,
    });
    const r = await getImapConfigPublic("t-1");
    expect(r?.passwordConfigured).toBe(true);
    expect(r).not.toHaveProperty("imapPasswordEnc");
    expect(r?.lastSyncAt).toBe("2026-05-25T10:00:00.000Z");
  });
});

describe("getImapConfigInternal", () => {
  test("null si imapHost null", async () => {
    findUniqueMock.mockResolvedValue({ imapHost: null });
    const r = await getImapConfigInternal("t-1");
    expect(r).toBeNull();
  });

  test("retourne passwordEnc + creds complets si config valide", async () => {
    findUniqueMock.mockResolvedValue({
      imapHost: "imap.x.com",
      imapPort: 993,
      imapUsername: "u",
      imapPasswordEnc: "iv:tag:ct",
      imapTls: true,
      imapFolder: "INBOX",
      imapLastUidSeen: null,
    });
    const r = await getImapConfigInternal("t-1");
    expect(r?.passwordEnc).toBe("iv:tag:ct");
    expect(r?.host).toBe("imap.x.com");
  });
});

describe("listImapEnabledTenants", () => {
  test("filtre les rows incomplètes", async () => {
    findManyMock.mockResolvedValue([
      {
        tenantId: "t-1",
        imapHost: "imap.x.com",
        imapPort: 993,
        imapUsername: "u",
        imapPasswordEnc: "iv:tag:ct",
        imapTls: true,
        imapFolder: "INBOX",
        imapLastUidSeen: null,
      },
    ]);
    const r = await listImapEnabledTenants();
    expect(r).toHaveLength(1);
    expect(r[0].tenantId).toBe("t-1");
    expect(r[0].passwordEnc).toBe("iv:tag:ct");
  });
});

describe("upsertImapConfig", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    upsertMock.mockReset();
  });

  test("chiffre le password et upsert", async () => {
    findUniqueMock.mockResolvedValue(null);
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      imapHost: "imap.x.com",
      imapPort: 993,
      imapUsername: "u",
      imapPasswordEnc: "iv:tag:ct",
      imapTls: true,
      imapFolder: "INBOX",
      imapLastUidSeen: null,
      imapLastSyncAt: null,
      imapLastSyncStatus: null,
      imapLastSyncError: null,
    });
    await upsertImapConfig("t-1", {
      host: "imap.x.com",
      port: 993,
      username: "u",
      password: "hunter2",
      tls: true,
      folder: "INBOX",
    });
    const args = upsertMock.mock.calls[0][0];
    // Le password doit être chiffré (format <iv>:<tag>:<ct>)
    expect(args.create.imapPasswordEnc).toMatch(/:/);
    expect(args.create.imapPasswordEnc).not.toBe("hunter2");
  });

  test("reset lastUidSeen si host change (account swap)", async () => {
    findUniqueMock.mockReset();
    findUniqueMock.mockResolvedValueOnce({
      imapHost: "imap.old.com",
      imapUsername: "u",
    });
    findUniqueMock.mockResolvedValueOnce({
      imapHost: "imap.new.com",
      imapPort: 993,
      imapUsername: "u",
      imapPasswordEnc: "iv:tag:ct",
      imapTls: true,
      imapFolder: "INBOX",
      imapLastUidSeen: null,
      imapLastSyncAt: null,
      imapLastSyncStatus: null,
      imapLastSyncError: null,
    });
    upsertMock.mockResolvedValue({});
    await upsertImapConfig("t-1", {
      host: "imap.new.com",
      port: 993,
      username: "u",
      password: "secret",
      tls: true,
      folder: "INBOX",
    });
    const args = upsertMock.mock.calls[0][0];
    expect(args.update.imapLastUidSeen).toBeNull();
  });
});

describe("clearImapConfig", () => {
  test("update tous les champs IMAP à null", async () => {
    updateMock.mockResolvedValue({});
    await clearImapConfig("t-1");
    const args = updateMock.mock.calls[0][0];
    expect(args.data.imapHost).toBeNull();
    expect(args.data.imapPasswordEnc).toBeNull();
    expect(args.data.imapLastUidSeen).toBeNull();
  });
});

describe("recordImapSyncResult", () => {
  test("écrit status + error + lastUidSeen", async () => {
    updateMock.mockResolvedValue({});
    await recordImapSyncResult("t-1", { status: "ok", error: null, lastUidSeen: 100 });
    const args = updateMock.mock.calls[0][0];
    expect(args.data.imapLastSyncStatus).toBe("ok");
    expect(args.data.imapLastUidSeen).toBe(100);
  });
});

describe("recordIncomingEmail", () => {
  test("crée la row direction=incoming + sent_status=received", async () => {
    createMock.mockResolvedValue({});
    const r = await recordIncomingEmail({
      tenantId: "t-1",
      siren: "123456789",
      messageId: "msg-1@x",
      inReplyTo: null,
      references: null,
      fromEmail: "x@y.fr",
      fromName: null,
      toEmails: ["u@v.fr"],
      ccEmails: [],
      subject: "Hi",
      bodyText: "body",
      bodyHtml: null,
      receivedAt: new Date(),
    });
    expect(r).toBe(true);
    const args = createMock.mock.calls[0][0];
    expect(args.data.direction).toBe("incoming");
    expect(args.data.sentStatus).toBe("received");
  });

  test("P2002 (duplicate messageId) swallow + return false", async () => {
    createMock.mockRejectedValue({ code: "P2002" });
    const r = await recordIncomingEmail({
      tenantId: "t-1",
      siren: null,
      messageId: "msg-dup@x",
      inReplyTo: null,
      references: null,
      fromEmail: "x@y.fr",
      fromName: null,
      toEmails: [],
      ccEmails: [],
      subject: null,
      bodyText: null,
      bodyHtml: null,
      receivedAt: new Date(),
    });
    expect(r).toBe(false);
  });

  test("autre erreur DB → throw", async () => {
    createMock.mockRejectedValue({ code: "P9999" });
    await expect(
      recordIncomingEmail({
        tenantId: "t-1",
        siren: null,
        messageId: "msg-fatal@x",
        inReplyTo: null,
        references: null,
        fromEmail: "x@y.fr",
        fromName: null,
        toEmails: [],
        ccEmails: [],
        subject: null,
        bodyText: null,
        bodyHtml: null,
        receivedAt: new Date(),
      }),
    ).rejects.toBeDefined();
  });
});

describe("updateMailSignature", () => {
  test("upsert avec html + enabled puis lit la nouvelle config publique", async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue({
      smtpHost: "smtp.test",
      smtpPort: 587,
      smtpUsername: "u",
      smtpPasswordEnc: "iv:tag:ct",
      smtpTls: true,
      smtpFromEmail: "f@test.com",
      smtpFromName: "F",
      lastTestAt: null,
      lastTestStatus: null,
      lastTestError: null,
      mailSignatureHtml: "<p>Robert</p>",
      mailSignatureEnabled: true,
    });
    const cfg = await updateMailSignature("tenant-1", {
      mailSignatureHtml: "<p>Robert</p>",
      mailSignatureEnabled: true,
    });
    expect(cfg.mailSignatureHtml).toBe("<p>Robert</p>");
    expect(cfg.mailSignatureEnabled).toBe(true);
    // upsert appelé avec EXACTEMENT le payload signature (sabotage check :
    // si quelqu'un swap les champs, l'assert deepEqual fail).
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-1" },
        update: {
          mailSignatureHtml: "<p>Robert</p>",
          mailSignatureEnabled: true,
        },
        create: expect.objectContaining({
          tenantId: "tenant-1",
          mailSignatureHtml: "<p>Robert</p>",
          mailSignatureEnabled: true,
        }),
      }),
    );
  });

  test("upsert avec html=null + enabled=false (toggle off sans perdre la sig)", async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue({
      smtpHost: null,
      smtpPort: null,
      smtpUsername: null,
      smtpPasswordEnc: null,
      smtpTls: true,
      smtpFromEmail: null,
      smtpFromName: null,
      lastTestAt: null,
      lastTestStatus: null,
      lastTestError: null,
      mailSignatureHtml: null,
      mailSignatureEnabled: false,
    });
    const cfg = await updateMailSignature("tenant-1", {
      mailSignatureHtml: null,
      mailSignatureEnabled: false,
    });
    expect(cfg.mailSignatureHtml).toBeNull();
    expect(cfg.mailSignatureEnabled).toBe(false);
  });
});

describe("getMailConfigPublic — signature fields exposés", () => {
  test("retourne mailSignatureHtml + mailSignatureEnabled dans la vue publique", async () => {
    findUniqueMock.mockResolvedValue({
      smtpHost: "smtp.test",
      smtpPort: 587,
      smtpUsername: "u",
      smtpPasswordEnc: "iv:tag:ct",
      smtpTls: true,
      smtpFromEmail: "f@test.com",
      smtpFromName: "F",
      lastTestAt: null,
      lastTestStatus: null,
      lastTestError: null,
      mailSignatureHtml: "<p>Sig</p>",
      mailSignatureEnabled: false,
    });
    const cfg = await getMailConfigPublic("tenant-1");
    // Sabotage check : si quelqu'un retire ces champs du return ou les
    // hardcode à null, ces 2 asserts rougissent.
    expect(cfg?.mailSignatureHtml).toBe("<p>Sig</p>");
    expect(cfg?.mailSignatureEnabled).toBe(false);
  });
});
