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
