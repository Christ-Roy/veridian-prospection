/**
 * Tests du wrapper SMTP nodemailer.
 *
 * Sabotage-test : si on enlève la classification d'erreur, `auth_failed` ne
 * sortirait plus, le test "535 → auth_failed" rougirait.
 */
import { describe, expect, test, vi, beforeEach, beforeAll } from "vitest";

const sendMailMock = vi.hoisted(() => vi.fn());
const verifyMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());
const createTransportMock = vi.hoisted(() =>
  vi.fn(() => ({
    sendMail: sendMailMock,
    verify: verifyMock,
    close: closeMock,
  })),
);

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
  createTransport: createTransportMock,
}));

beforeAll(() => {
  process.env.AUTH_SECRET = "a".repeat(32);
});

import { encryptPassword } from "@/lib/crypto/encrypt-password";
import { sendMail, testConnection, classifyError, type SmtpCredentials } from "@/lib/mail/smtp";

function makeCreds(): SmtpCredentials {
  return {
    host: "smtp.example.com",
    port: 587,
    username: "user@example.com",
    passwordEnc: encryptPassword("hunter2"),
    tls: true,
    fromEmail: "user@example.com",
    fromName: "Robert Brunon",
  };
}

describe("sendMail", () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    verifyMock.mockReset();
    closeMock.mockReset();
    createTransportMock.mockClear();
  });

  test("retourne { ok: false, missing_credentials } si host vide", async () => {
    const res = await sendMail(
      { ...makeCreds(), host: "" },
      { to: "a@b.c", subject: "s", bodyText: "t", bodyHtml: "<p>t</p>" },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("missing_credentials");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  test("retourne { ok: true, messageId } sur send réussi", async () => {
    sendMailMock.mockResolvedValue({ messageId: "<abc@host>" });
    const res = await sendMail(makeCreds(), {
      to: "alice@acme.com",
      subject: "Hello",
      bodyText: "Hi Alice",
      bodyHtml: "<p>Hi Alice</p>",
    });
    expect(res.ok).toBe(true);
    expect(res.messageId).toBe("<abc@host>");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Robert Brunon" <user@example.com>',
        to: "alice@acme.com",
        subject: "Hello",
        text: "Hi Alice",
        html: "<p>Hi Alice</p>",
      }),
    );
    expect(closeMock).toHaveBeenCalled();
  });

  test("joint les cc en CSV", async () => {
    sendMailMock.mockResolvedValue({ messageId: "<x@h>" });
    await sendMail(makeCreds(), {
      to: "a@b.c",
      cc: ["c1@b.c", "c2@b.c"],
      subject: "s",
      bodyText: "t",
      bodyHtml: "<p>t</p>",
    });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ cc: "c1@b.c, c2@b.c" }),
    );
  });

  test("retourne reason=auth_failed sur code EAUTH", async () => {
    sendMailMock.mockRejectedValue({ code: "EAUTH", responseCode: 535, message: "auth" });
    const res = await sendMail(makeCreds(), {
      to: "a@b.c",
      subject: "s",
      bodyText: "t",
      bodyHtml: "<p>t</p>",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("auth_failed");
    expect(res.smtpCode).toBe("535");
  });

  test("retourne reason=decrypt_failed si passwordEnc corrompu", async () => {
    const res = await sendMail(
      { ...makeCreds(), passwordEnc: "garbage:not:base64!" },
      { to: "a@b.c", subject: "s", bodyText: "t", bodyHtml: "<p>t</p>" },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("decrypt_failed");
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("testConnection", () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    verifyMock.mockReset();
    closeMock.mockReset();
    createTransportMock.mockClear();
  });

  test("retourne ok=true si verify() résout", async () => {
    verifyMock.mockResolvedValue(true);
    const res = await testConnection(makeCreds());
    expect(res.ok).toBe(true);
    expect(verifyMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
  });

  test("retourne reason=host_unreachable sur ECONNREFUSED", async () => {
    verifyMock.mockRejectedValue({ code: "ECONNREFUSED", message: "refused" });
    const res = await testConnection(makeCreds());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("host_unreachable");
  });

  test("retourne reason=missing_credentials si username vide", async () => {
    const res = await testConnection({ ...makeCreds(), username: "" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("missing_credentials");
    expect(verifyMock).not.toHaveBeenCalled();
  });
});

describe("classifyError", () => {
  test("EAUTH → auth_failed", () => {
    expect(classifyError({ code: "EAUTH", responseCode: 535 }).reason).toBe(
      "auth_failed",
    );
  });
  test("ETIMEDOUT → timeout", () => {
    expect(classifyError({ code: "ETIMEDOUT" }).reason).toBe("timeout");
  });
  test("ECONNECTION → host_unreachable", () => {
    expect(classifyError({ code: "ECONNECTION" }).reason).toBe("host_unreachable");
  });
  test("message contient 'TLS' → tls_error", () => {
    expect(classifyError({ message: "TLS handshake failed" }).reason).toBe(
      "tls_error",
    );
  });
  test("responseCode 5xx sans code → rejected", () => {
    expect(classifyError({ responseCode: 550, message: "Mailbox not found" }).reason).toBe(
      "rejected",
    );
  });
  test("erreur inconnue → unknown", () => {
    expect(classifyError({ message: "wtf" }).reason).toBe("unknown");
  });
});
