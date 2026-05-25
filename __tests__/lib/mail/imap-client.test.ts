/**
 * Tests du wrapper IMAP imapflow.
 *
 * Sabotage-test : si on supprime classifyImapError, l'erreur authenticationFailed
 * ne serait plus mappée à auth_failed et le test "auth fail → reason=auth_failed"
 * rougirait.
 */
import { describe, expect, test, vi, beforeEach, beforeAll } from "vitest";

const {
  connectMock,
  logoutMock,
  getMailboxLockMock,
  fetchMock,
  fetchOneMock,
  releaseMock,
  ImapFlowCtor,
  simpleParserMock,
} = vi.hoisted(() => {
  const connectMock = vi.fn();
  const logoutMock = vi.fn();
  const getMailboxLockMock = vi.fn();
  const fetchMock = vi.fn();
  const fetchOneMock = vi.fn();
  const releaseMock = vi.fn();
  const simpleParserMock = vi.fn();
  class ImapFlowCtor {
    socketTimeout?: number;
    constructor(opts: Record<string, unknown>) {
      this.socketTimeout = opts.socketTimeout as number;
    }
    connect = connectMock;
    logout = logoutMock;
    getMailboxLock = getMailboxLockMock;
    fetch = fetchMock;
    fetchOne = fetchOneMock;
  }
  return {
    connectMock,
    logoutMock,
    getMailboxLockMock,
    fetchMock,
    fetchOneMock,
    releaseMock,
    ImapFlowCtor,
    simpleParserMock,
  };
});

vi.mock("imapflow", () => ({
  ImapFlow: ImapFlowCtor,
}));

vi.mock("mailparser", () => ({
  simpleParser: simpleParserMock,
}));

beforeAll(() => {
  process.env.AUTH_SECRET = "a".repeat(32);
});

import { encryptPassword } from "@/lib/crypto/encrypt-password";
import {
  fetchNewMessages,
  testImapConnection,
  classifyImapError,
  type ImapCredentials,
} from "@/lib/mail/imap-client";

function makeCreds(): ImapCredentials {
  return {
    host: "imap.example.com",
    port: 993,
    username: "user@example.com",
    passwordEnc: encryptPassword("hunter2"),
    tls: true,
    folder: "INBOX",
  };
}

async function* asyncIter<T>(items: T[]): AsyncGenerator<T> {
  for (const i of items) yield i;
}

describe("classifyImapError", () => {
  test("authenticationFailed → auth_failed", () => {
    expect(classifyImapError({ authenticationFailed: true, message: "LOGIN failed" }).reason).toBe(
      "auth_failed",
    );
  });
  test("message contient LOGIN failed → auth_failed", () => {
    expect(classifyImapError({ message: "LOGIN failed" }).reason).toBe("auth_failed");
  });
  test("ETIMEDOUT → timeout", () => {
    expect(classifyImapError({ code: "ETIMEDOUT", message: "timeout" }).reason).toBe("timeout");
  });
  test("ECONNREFUSED → host_unreachable", () => {
    expect(classifyImapError({ code: "ECONNREFUSED", message: "refused" }).reason).toBe(
      "host_unreachable",
    );
  });
  test("certificate error → tls_error", () => {
    expect(classifyImapError({ message: "self signed certificate" }).reason).toBe("tls_error");
  });
  test("no such mailbox → folder_not_found", () => {
    expect(classifyImapError({ message: "no such mailbox: INBOX" }).reason).toBe(
      "folder_not_found",
    );
  });
  test("inconnu → unknown", () => {
    expect(classifyImapError({ message: "wat" }).reason).toBe("unknown");
  });
});

describe("fetchNewMessages", () => {
  beforeEach(() => {
    connectMock.mockReset();
    logoutMock.mockReset();
    getMailboxLockMock.mockReset();
    fetchMock.mockReset();
    fetchOneMock.mockReset();
    releaseMock.mockReset();
    simpleParserMock.mockReset();
    getMailboxLockMock.mockResolvedValue({ release: releaseMock });
    logoutMock.mockResolvedValue(undefined);
  });

  test("missing_credentials si host vide", async () => {
    const res = await fetchNewMessages(
      { ...makeCreds(), host: "" },
      null,
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("missing_credentials");
  });

  test("connect échoue (auth) → reason=auth_failed", async () => {
    connectMock.mockRejectedValue({ authenticationFailed: true, message: "LOGIN failed" });
    const res = await fetchNewMessages(makeCreds(), null);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("auth_failed");
  });

  test("fetch retourne 0 UIDs → lastUid null, messages vide", async () => {
    connectMock.mockResolvedValue(undefined);
    fetchMock.mockImplementation(() => asyncIter([]));
    const res = await fetchNewMessages(makeCreds(), null);
    expect(res.ok).toBe(true);
    expect(res.messages).toEqual([]);
    expect(res.lastUid).toBeNull();
  });

  test("incrémental : range = lastUid+1:*", async () => {
    connectMock.mockResolvedValue(undefined);
    fetchMock.mockImplementation((range: string) => {
      expect(range).toBe("43:*");
      return asyncIter([]);
    });
    await fetchNewMessages(makeCreds(), 42);
  });

  test("parse message → fromEmail, subject, messageId", async () => {
    connectMock.mockResolvedValue(undefined);
    fetchMock.mockImplementation(() => asyncIter([{ uid: 10 }]));
    fetchOneMock.mockResolvedValue({ uid: 10, source: Buffer.from("rfc822") });
    simpleParserMock.mockResolvedValue({
      messageId: "<abc@example.com>",
      from: { value: [{ address: "FOO@EXAMPLE.com", name: "Foo" }] },
      to: { value: [{ address: "user@example.com" }] },
      subject: "Hello",
      text: "Plain body",
      html: "<p>HTML</p>",
      date: new Date("2026-05-25T10:00:00Z"),
    });
    const res = await fetchNewMessages(makeCreds(), null);
    expect(res.ok).toBe(true);
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0].messageId).toBe("abc@example.com");
    expect(res.messages[0].fromEmail).toBe("foo@example.com");
    expect(res.messages[0].fromName).toBe("Foo");
    expect(res.messages[0].subject).toBe("Hello");
    expect(res.messages[0].bodyText).toBe("Plain body");
    expect(res.lastUid).toBe(10);
  });

  test("message-id absent → fallback imap-uid-<uid>@host", async () => {
    connectMock.mockResolvedValue(undefined);
    fetchMock.mockImplementation(() => asyncIter([{ uid: 17 }]));
    fetchOneMock.mockResolvedValue({ uid: 17, source: Buffer.from("x") });
    simpleParserMock.mockResolvedValue({
      messageId: null,
      from: { value: [{ address: "x@y.com" }] },
      to: { value: [] },
      subject: null,
      text: null,
      html: null,
      date: undefined,
    });
    const res = await fetchNewMessages(makeCreds(), null);
    expect(res.messages[0].messageId).toBe("imap-uid-17@imap.example.com");
  });

  test("plus de 200 UIDs → cap aux 200 plus récents", async () => {
    connectMock.mockResolvedValue(undefined);
    const items = Array.from({ length: 500 }, (_, i) => ({ uid: i + 1 }));
    fetchMock.mockImplementation(() => asyncIter(items));
    fetchOneMock.mockImplementation(async (uid: number) => ({
      uid,
      source: Buffer.from("x"),
    }));
    simpleParserMock.mockResolvedValue({
      messageId: null,
      from: { value: [{ address: "x@y.com" }] },
      to: { value: [] },
      subject: null,
      text: null,
      html: null,
      date: undefined,
    });
    const res = await fetchNewMessages(makeCreds(), null);
    expect(res.messages.length).toBe(200);
    // Pris les 200 derniers : UIDs 301..500.
    expect(res.lastUid).toBe(500);
  });

  test("parse fail sur un mail → skip ce mail, continue les autres", async () => {
    connectMock.mockResolvedValue(undefined);
    fetchMock.mockImplementation(() => asyncIter([{ uid: 1 }, { uid: 2 }]));
    fetchOneMock.mockImplementation(async (uid: number) => ({
      uid,
      source: Buffer.from("x"),
    }));
    simpleParserMock.mockImplementationOnce(() => Promise.reject(new Error("broken")));
    simpleParserMock.mockResolvedValueOnce({
      messageId: "<ok@example.com>",
      from: { value: [{ address: "ok@example.com" }] },
      to: { value: [] },
      subject: null,
      text: null,
      html: null,
      date: undefined,
    });
    const res = await fetchNewMessages(makeCreds(), null);
    expect(res.ok).toBe(true);
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0].messageId).toBe("ok@example.com");
  });
});

describe("testImapConnection", () => {
  beforeEach(() => {
    connectMock.mockReset();
    logoutMock.mockReset();
    getMailboxLockMock.mockReset();
    releaseMock.mockReset();
    getMailboxLockMock.mockResolvedValue({ release: releaseMock });
    logoutMock.mockResolvedValue(undefined);
  });

  test("OK = ok true", async () => {
    connectMock.mockResolvedValue(undefined);
    const res = await testImapConnection(makeCreds());
    expect(res.ok).toBe(true);
  });

  test("connect fail → reason mappé", async () => {
    connectMock.mockRejectedValue({ code: "ECONNREFUSED", message: "refused" });
    const res = await testImapConnection(makeCreds());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("host_unreachable");
  });

  test("missing_credentials si username vide", async () => {
    const res = await testImapConnection({ ...makeCreds(), username: "" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("missing_credentials");
  });
});
