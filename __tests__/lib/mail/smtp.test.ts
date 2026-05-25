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

  // --- Cases additionnels (hardening v1) ---

  test("ECONNREFUSED → host_unreachable (port fermé)", () => {
    expect(
      classifyError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" })
        .reason,
    ).toBe("host_unreachable");
  });

  test("ENOTFOUND → host_unreachable (DNS KO)", () => {
    expect(
      classifyError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" })
        .reason,
    ).toBe("host_unreachable");
  });

  test("ESOCKET → timeout (socket coupé)", () => {
    expect(classifyError({ code: "ESOCKET", message: "socket hang up" }).reason).toBe(
      "timeout",
    );
  });

  test("ETLS → tls_error (handshake explicite)", () => {
    expect(classifyError({ code: "ETLS", message: "TLS negotiation" }).reason).toBe(
      "tls_error",
    );
  });

  test("message 'certificate' (sans code) → tls_error", () => {
    expect(
      classifyError({ message: "self signed certificate in chain" }).reason,
    ).toBe("tls_error");
  });

  test("responseCode 534 → auth_failed (Gmail OAuth required)", () => {
    expect(classifyError({ responseCode: 534, message: "Application-specific password required" }).reason).toBe(
      "auth_failed",
    );
  });

  test("classifyError préserve le message original (debug UI)", () => {
    const { message } = classifyError({
      code: "EAUTH",
      responseCode: 535,
      message: "535 5.7.0 Authentication credentials invalid",
    });
    expect(message).toContain("Authentication");
  });

  test("classifyError sur une string brute (err raw)", () => {
    expect(classifyError("naked string error").reason).toBe("unknown");
  });

  test("classifyError sur une Error JS standard", () => {
    expect(classifyError(new Error("boom")).reason).toBe("unknown");
  });
});

describe("sendMail — error cases additionnels (hardening v1)", () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    verifyMock.mockReset();
    closeMock.mockReset();
    createTransportMock.mockClear();
  });

  test("ECONNREFUSED côté nodemailer → reason=host_unreachable, errorMessage propagé", async () => {
    sendMailMock.mockRejectedValue({
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 127.0.0.1:9999",
    });
    const res = await sendMail(makeCreds(), {
      to: "a@b.c",
      subject: "s",
      bodyText: "t",
      bodyHtml: "<p>t</p>",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("host_unreachable");
    expect(res.errorMessage).toContain("ECONNREFUSED");
    expect(closeMock).toHaveBeenCalled();
  });

  test("ETIMEDOUT côté nodemailer → reason=timeout", async () => {
    sendMailMock.mockRejectedValue({
      code: "ETIMEDOUT",
      message: "operation timed out",
    });
    const res = await sendMail(makeCreds(), {
      to: "a@b.c",
      subject: "s",
      bodyText: "t",
      bodyHtml: "<p>t</p>",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("timeout");
    expect(res.errorMessage).toBe("operation timed out");
  });

  test("EAUTH 535 → reason=auth_failed + smtpCode='535'", async () => {
    sendMailMock.mockRejectedValue({
      code: "EAUTH",
      responseCode: 535,
      message: "535 Authentication failed",
    });
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

  test("TLS error sur le verify → testConnection retourne tls_error", async () => {
    verifyMock.mockRejectedValue({
      code: "ETLS",
      message: "TLS handshake failed",
    });
    const res = await testConnection(makeCreds());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("tls_error");
  });

  test("reject 550 mailbox unknown → reason=rejected (5xx)", async () => {
    sendMailMock.mockRejectedValue({
      responseCode: 550,
      message: "550 5.1.1 Mailbox unavailable",
    });
    const res = await sendMail(makeCreds(), {
      to: "ghost@nowhere.com",
      subject: "s",
      bodyText: "t",
      bodyHtml: "<p>t</p>",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("rejected");
    expect(res.smtpCode).toBe("550");
  });

  test("transporter.close() est appelé même quand send throw", async () => {
    sendMailMock.mockRejectedValue({ code: "EAUTH", message: "auth" });
    await sendMail(makeCreds(), {
      to: "a@b.c",
      subject: "s",
      bodyText: "t",
      bodyHtml: "<p>t</p>",
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  test("fromName échappe les guillemets (header SMTP safe)", async () => {
    sendMailMock.mockResolvedValue({ messageId: "<x@h>" });
    await sendMail(
      { ...makeCreds(), fromName: 'Robert "Boss" Brunon' },
      { to: "a@b.c", subject: "s", bodyText: "t", bodyHtml: "<p>t</p>" },
    );
    const callArg = sendMailMock.mock.calls[0]?.[0] as { from: string };
    // Le wrapper retire les `"` du fromName pour éviter de casser le header.
    expect(callArg.from).toBe('"Robert Boss Brunon" <user@example.com>');
  });
});
