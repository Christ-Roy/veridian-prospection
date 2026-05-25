/**
 * Tests de l'orchestrateur imap-sync.
 *
 * Sabotage-test : si on enlève la persistence imap_last_uid_seen, le test
 * "lastUid persistéé même quand 0 nouveau message" rougirait.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";

const {
  fetchNewMessagesMock,
  matchProspectByEmailMock,
  listImapEnabledTenantsMock,
  recordImapSyncResultMock,
  recordIncomingEmailMock,
} = vi.hoisted(() => ({
  fetchNewMessagesMock: vi.fn(),
  matchProspectByEmailMock: vi.fn(),
  listImapEnabledTenantsMock: vi.fn(),
  recordImapSyncResultMock: vi.fn(),
  recordIncomingEmailMock: vi.fn(),
}));

vi.mock("@/lib/mail/imap-client", () => ({
  fetchNewMessages: fetchNewMessagesMock,
}));
vi.mock("@/lib/mail/match-prospect", () => ({
  matchProspectByEmail: matchProspectByEmailMock,
}));
vi.mock("@/lib/mail/queries", () => ({
  listImapEnabledTenants: listImapEnabledTenantsMock,
  recordImapSyncResult: recordImapSyncResultMock,
  recordIncomingEmail: recordIncomingEmailMock,
}));

import { runImapSync, syncOneTenant } from "@/lib/mail/imap-sync";

function makeTenantCreds() {
  return {
    tenantId: "t-1",
    host: "imap.x.com",
    port: 993,
    username: "u",
    passwordEnc: "iv:tag:ct",
    tls: true,
    folder: "INBOX",
    lastUidSeen: null,
  };
}

function makeMessage(overrides: Partial<{ uid: number; messageId: string; fromEmail: string }> = {}) {
  return {
    uid: overrides.uid ?? 1,
    messageId: overrides.messageId ?? "msg-1@x",
    inReplyTo: null,
    references: null,
    fromEmail: overrides.fromEmail ?? "x@y.fr",
    fromName: null,
    toEmails: ["user@example.com"],
    ccEmails: [],
    subject: "Hello",
    bodyText: "body",
    bodyHtml: null,
    receivedAt: new Date(),
  };
}

describe("syncOneTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("happy : 1 message → match siren → inserted=1, matched=1", async () => {
    fetchNewMessagesMock.mockResolvedValue({
      ok: true,
      messages: [makeMessage({ uid: 5 })],
      lastUid: 5,
    });
    matchProspectByEmailMock.mockResolvedValue("123456789");
    recordIncomingEmailMock.mockResolvedValue(true);

    const r = await syncOneTenant(makeTenantCreds());
    expect(r.ok).toBe(true);
    expect(r.fetched).toBe(1);
    expect(r.inserted).toBe(1);
    expect(r.matched).toBe(1);
    expect(r.unmatched).toBe(0);
    expect(r.duplicates).toBe(0);
    expect(recordImapSyncResultMock).toHaveBeenCalledWith("t-1", expect.objectContaining({
      status: "ok",
      lastUidSeen: 5,
    }));
  });

  test("from inconnu → unmatched count incrémenté, siren null", async () => {
    fetchNewMessagesMock.mockResolvedValue({
      ok: true,
      messages: [makeMessage({ fromEmail: "inconnu@nowhere.com" })],
      lastUid: 1,
    });
    matchProspectByEmailMock.mockResolvedValue(null);
    recordIncomingEmailMock.mockResolvedValue(true);

    const r = await syncOneTenant(makeTenantCreds());
    expect(r.unmatched).toBe(1);
    expect(r.matched).toBe(0);
    expect(recordIncomingEmailMock.mock.calls[0][0].siren).toBeNull();
  });

  test("duplicate (record renvoie false) → duplicates++ pas inserted", async () => {
    fetchNewMessagesMock.mockResolvedValue({
      ok: true,
      messages: [makeMessage()],
      lastUid: 1,
    });
    matchProspectByEmailMock.mockResolvedValue(null);
    recordIncomingEmailMock.mockResolvedValue(false);

    const r = await syncOneTenant(makeTenantCreds());
    expect(r.inserted).toBe(0);
    expect(r.duplicates).toBe(1);
  });

  test("fetch error (auth_failed) → ok=false, status persisté", async () => {
    fetchNewMessagesMock.mockResolvedValue({
      ok: false,
      reason: "auth_failed",
      errorMessage: "LOGIN failed",
      messages: [],
      lastUid: null,
    });

    const r = await syncOneTenant(makeTenantCreds());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("auth_failed");
    expect(recordImapSyncResultMock).toHaveBeenCalledWith("t-1", expect.objectContaining({
      status: "auth_failed",
      error: "LOGIN failed",
    }));
  });

  test("body vide → fallback (no body) injecté", async () => {
    fetchNewMessagesMock.mockResolvedValue({
      ok: true,
      messages: [{ ...makeMessage(), bodyText: "" }],
      lastUid: 1,
    });
    matchProspectByEmailMock.mockResolvedValue(null);
    recordIncomingEmailMock.mockResolvedValue(true);

    await syncOneTenant(makeTenantCreds());
    expect(recordIncomingEmailMock.mock.calls[0][0].bodyText).toBe("(no body)");
  });

  test("from null → fromEmail string fallback (unknown)", async () => {
    fetchNewMessagesMock.mockResolvedValue({
      ok: true,
      messages: [{ ...makeMessage(), fromEmail: null }],
      lastUid: 1,
    });
    matchProspectByEmailMock.mockResolvedValue(null);
    recordIncomingEmailMock.mockResolvedValue(true);

    await syncOneTenant(makeTenantCreds());
    expect(recordIncomingEmailMock.mock.calls[0][0].fromEmail).toBe("(unknown)");
  });

  test("recordIncomingEmail throw → swallowed + duplicate count", async () => {
    fetchNewMessagesMock.mockResolvedValue({
      ok: true,
      messages: [makeMessage()],
      lastUid: 1,
    });
    matchProspectByEmailMock.mockResolvedValue(null);
    recordIncomingEmailMock.mockRejectedValue(new Error("DB down"));

    const r = await syncOneTenant(makeTenantCreds());
    // Pas de throw, mais inserted=0 + duplicates=1 (fallback false).
    expect(r.inserted).toBe(0);
    expect(r.duplicates).toBe(1);
  });
});

describe("runImapSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("0 tenants → totalTenants 0", async () => {
    listImapEnabledTenantsMock.mockResolvedValue([]);
    const r = await runImapSync();
    expect(r.totalTenants).toBe(0);
    expect(r.totalInserted).toBe(0);
  });

  test("multi-tenant : un fail ne bloque pas les autres", async () => {
    listImapEnabledTenantsMock.mockResolvedValue([
      makeTenantCreds(),
      { ...makeTenantCreds(), tenantId: "t-2" },
    ]);
    fetchNewMessagesMock
      .mockResolvedValueOnce({
        ok: false,
        reason: "auth_failed",
        errorMessage: "fail",
        messages: [],
        lastUid: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        messages: [makeMessage()],
        lastUid: 1,
      });
    matchProspectByEmailMock.mockResolvedValue(null);
    recordIncomingEmailMock.mockResolvedValue(true);

    const r = await runImapSync();
    expect(r.totalTenants).toBe(2);
    expect(r.okTenants).toBe(1);
    expect(r.failedTenants).toBe(1);
    expect(r.totalInserted).toBe(1);
  });
});
