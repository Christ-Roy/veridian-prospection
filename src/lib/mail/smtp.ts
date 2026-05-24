/**
 * Wrapper SMTP nodemailer pour Prospection — v1 envoi sortant BYO commercial.
 *
 * Cadrage Robert 2026-05-23 : pas de relay Veridian, l'user envoie avec
 * ses propres credentials (SPF/DKIM de son domaine). Notifuse reste séparé
 * (transactionnel plateforme, owner = Veridian).
 *
 * Pattern best-effort à la Notifuse client : retourne un résultat structuré
 * `{ ok, messageId?, reason?, status? }` plutôt que de throw — on alimente
 * directement `lead_emails.sent_status` + `sent_error`.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { decryptPassword } from "@/lib/crypto/encrypt-password";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface SmtpCredentials {
  host: string;
  port: number;
  username: string;
  /** Déjà chiffré AES-256-GCM en DB (smtp_password_enc). */
  passwordEnc: string;
  /** true = STARTTLS sur 587 ou TLS direct sur 465. Le port décide en interne. */
  tls: boolean;
  fromEmail: string;
  fromName: string | null;
}

export interface SendMailInput {
  to: string;
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  /** Optionnel : header `In-Reply-To` pour threading (v2 IMAP). */
  inReplyTo?: string;
  /** Optionnel : header `References` (chain message-id). */
  references?: string;
}

export type SendReason =
  | "missing_credentials"
  | "decrypt_failed"
  | "auth_failed"
  | "host_unreachable"
  | "timeout"
  | "tls_error"
  | "rejected"
  | "unknown";

export interface SendResult {
  ok: boolean;
  messageId?: string;
  reason?: SendReason;
  /** Code SMTP brut quand dispo (ex: 535 auth, 550 rejected). */
  smtpCode?: string;
  /** Message brut renvoyé par nodemailer / le serveur — pour debug UI. */
  errorMessage?: string;
}

/** Crée un transporter nodemailer typé. Séparé pour faciliter le mock. */
export function createTransport(creds: SmtpCredentials): Transporter {
  let password: string;
  try {
    password = decryptPassword(creds.passwordEnc);
  } catch (err) {
    throw new Error(
      `SMTP password decryption failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    // secure=true → TLS direct (465). secure=false + tls=true → STARTTLS (587).
    secure: creds.port === 465,
    requireTLS: creds.tls && creds.port !== 465,
    auth: {
      user: creds.username,
      pass: password,
    },
    connectionTimeout: DEFAULT_TIMEOUT_MS,
    greetingTimeout: DEFAULT_TIMEOUT_MS,
    socketTimeout: DEFAULT_TIMEOUT_MS,
  });
}

/** Mappe une erreur nodemailer → reason structuré pour l'UI. */
export function classifyError(err: unknown): { reason: SendReason; smtpCode?: string; message: string } {
  const e = err as { code?: string; response?: string; responseCode?: number; message?: string };
  const message = e.message ?? String(err);
  const code = e.code;
  const responseCode = e.responseCode?.toString();

  if (code === "EAUTH" || responseCode === "535" || responseCode === "534") {
    return { reason: "auth_failed", smtpCode: responseCode, message };
  }
  if (code === "ETIMEDOUT" || code === "ESOCKET") {
    return { reason: "timeout", smtpCode: responseCode, message };
  }
  if (code === "ECONNECTION" || code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return { reason: "host_unreachable", smtpCode: responseCode, message };
  }
  if (code === "ETLS" || /tls|ssl|certificate/i.test(message)) {
    return { reason: "tls_error", smtpCode: responseCode, message };
  }
  if (responseCode && responseCode.startsWith("5")) {
    return { reason: "rejected", smtpCode: responseCode, message };
  }
  return { reason: "unknown", smtpCode: responseCode, message };
}

/**
 * Envoie un mail via SMTP du tenant. Best-effort : ne throw jamais — retourne
 * un SendResult que le caller mappe en `lead_emails.sent_status`.
 */
export async function sendMail(
  creds: SmtpCredentials,
  input: SendMailInput,
): Promise<SendResult> {
  if (!creds.host || !creds.port || !creds.username || !creds.passwordEnc) {
    return { ok: false, reason: "missing_credentials" };
  }

  let transporter: Transporter;
  try {
    transporter = createTransport(creds);
  } catch (err) {
    return {
      ok: false,
      reason: "decrypt_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const info = await transporter.sendMail({
      from: creds.fromName
        ? `"${creds.fromName.replace(/"/g, "")}" <${creds.fromEmail}>`
        : creds.fromEmail,
      to: input.to,
      cc: input.cc && input.cc.length > 0 ? input.cc.join(", ") : undefined,
      subject: input.subject,
      text: input.bodyText,
      html: input.bodyHtml,
      inReplyTo: input.inReplyTo,
      references: input.references,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const { reason, smtpCode, message } = classifyError(err);
    return { ok: false, reason, smtpCode, errorMessage: message };
  } finally {
    transporter.close();
  }
}

/**
 * Test la connexion SMTP (handshake + auth) sans envoyer de mail. Utilisé par
 * /api/mail/test-connection (bouton "Tester la connexion" dans /settings/mail).
 */
export async function testConnection(creds: SmtpCredentials): Promise<SendResult> {
  if (!creds.host || !creds.port || !creds.username || !creds.passwordEnc) {
    return { ok: false, reason: "missing_credentials" };
  }
  let transporter: Transporter;
  try {
    transporter = createTransport(creds);
  } catch (err) {
    return {
      ok: false,
      reason: "decrypt_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const { reason, smtpCode, message } = classifyError(err);
    return { ok: false, reason, smtpCode, errorMessage: message };
  } finally {
    transporter.close();
  }
}
