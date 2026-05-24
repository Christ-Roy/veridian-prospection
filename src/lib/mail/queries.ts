/**
 * Queries DB pour le mail SMTP v1.
 *
 * Sépare la lecture "client safe" (pas de password) de la lecture interne
 * (avec passwordEnc pour le wrapper SMTP).
 */
import { prisma } from "@/lib/prisma";
import {
  encryptPassword,
  isPasswordConfigured,
} from "@/lib/crypto/encrypt-password";

/** Vue safe pour le client UI (page /settings/mail). Pas de password. */
export interface MailConfigPublic {
  host: string | null;
  port: number | null;
  username: string | null;
  tls: boolean;
  fromEmail: string | null;
  fromName: string | null;
  /** True si un password chiffré est stocké. Permet à l'UI d'afficher "•••". */
  passwordConfigured: boolean;
  lastTestAt: string | null;
  lastTestStatus: string | null;
  lastTestError: string | null;
}

/** Vue interne avec passwordEnc — usage strictement serveur (envoi SMTP). */
export interface MailConfigInternal {
  host: string;
  port: number;
  username: string;
  passwordEnc: string;
  tls: boolean;
  fromEmail: string;
  fromName: string | null;
}

/** Lit la config mail d'un tenant en vue publique (pour UI). */
export async function getMailConfigPublic(
  tenantId: string,
): Promise<MailConfigPublic | null> {
  const row = await prisma.tenantMailConfig.findUnique({
    where: { tenantId },
  });
  if (!row) return null;
  return {
    host: row.smtpHost,
    port: row.smtpPort,
    username: row.smtpUsername,
    tls: row.smtpTls,
    fromEmail: row.smtpFromEmail,
    fromName: row.smtpFromName,
    passwordConfigured: isPasswordConfigured(row.smtpPasswordEnc),
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
  };
}

/** Lit la config mail d'un tenant en vue interne (avec passwordEnc). */
export async function getMailConfigInternal(
  tenantId: string,
): Promise<MailConfigInternal | null> {
  const row = await prisma.tenantMailConfig.findUnique({
    where: { tenantId },
  });
  if (
    !row ||
    !row.smtpHost ||
    !row.smtpPort ||
    !row.smtpUsername ||
    !row.smtpPasswordEnc ||
    !row.smtpFromEmail
  ) {
    return null;
  }
  return {
    host: row.smtpHost,
    port: row.smtpPort,
    username: row.smtpUsername,
    passwordEnc: row.smtpPasswordEnc,
    tls: row.smtpTls,
    fromEmail: row.smtpFromEmail,
    fromName: row.smtpFromName,
  };
}

export interface UpsertMailConfigInput {
  host: string;
  port: number;
  username: string;
  /** Plaintext password. Si undefined, ne touche pas le password existant. */
  password?: string;
  tls: boolean;
  fromEmail: string;
  fromName: string | null;
}

/** Upsert la config mail d'un tenant. Chiffre le password à la volée. */
export async function upsertMailConfig(
  tenantId: string,
  input: UpsertMailConfigInput,
): Promise<MailConfigPublic> {
  const passwordEnc =
    input.password && input.password.length > 0
      ? encryptPassword(input.password)
      : undefined;

  await prisma.tenantMailConfig.upsert({
    where: { tenantId },
    update: {
      smtpHost: input.host,
      smtpPort: input.port,
      smtpUsername: input.username,
      ...(passwordEnc !== undefined ? { smtpPasswordEnc: passwordEnc } : {}),
      smtpTls: input.tls,
      smtpFromEmail: input.fromEmail,
      smtpFromName: input.fromName,
    },
    create: {
      tenantId,
      smtpHost: input.host,
      smtpPort: input.port,
      smtpUsername: input.username,
      smtpPasswordEnc: passwordEnc ?? null,
      smtpTls: input.tls,
      smtpFromEmail: input.fromEmail,
      smtpFromName: input.fromName,
    },
  });
  const fresh = await getMailConfigPublic(tenantId);
  // Garanti par l'upsert qui précède.
  return fresh!;
}

/** Sauvegarde le résultat d'un test de connexion. */
export async function recordTestResult(
  tenantId: string,
  status: string,
  error: string | null,
): Promise<void> {
  await prisma.tenantMailConfig.update({
    where: { tenantId },
    data: {
      lastTestAt: new Date(),
      lastTestStatus: status,
      lastTestError: error,
    },
  });
}

export interface RecordSentEmailInput {
  tenantId: string;
  workspaceId: string | null;
  userId: string | null;
  siren: string | null;
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  templateSlug: string | null;
}

/** Trace un mail envoyé (status="sent"). */
export async function recordSentEmail(
  input: RecordSentEmailInput,
): Promise<void> {
  await prisma.leadEmail.create({
    data: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      siren: input.siren,
      direction: "outgoing",
      messageId: input.messageId,
      fromEmail: input.fromEmail,
      fromName: input.fromName,
      toEmails: input.toEmails,
      ccEmails: input.ccEmails,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
      templateSlug: input.templateSlug,
      sentStatus: "sent",
      sentAt: new Date(),
    },
  });
}

/** Trace une tentative d'envoi en échec (status="failed"). */
export async function recordFailedEmail(
  input: Omit<RecordSentEmailInput, "messageId"> & {
    messageId: string;
    errorMessage: string;
  },
): Promise<void> {
  await prisma.leadEmail.create({
    data: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      siren: input.siren,
      direction: "outgoing",
      messageId: input.messageId,
      fromEmail: input.fromEmail,
      fromName: input.fromName,
      toEmails: input.toEmails,
      ccEmails: input.ccEmails,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
      templateSlug: input.templateSlug,
      sentStatus: "failed",
      sentError: input.errorMessage,
    },
  });
}

/** Liste les mails envoyés à un prospect (timeline 360°). */
export async function listLeadEmails(
  tenantId: string,
  siren: string,
  limit = 50,
): Promise<
  Array<{
    id: string;
    direction: string;
    subject: string | null;
    fromEmail: string;
    toEmails: string[];
    sentAt: Date | null;
    sentStatus: string;
    bodyText: string | null;
  }>
> {
  return prisma.leadEmail.findMany({
    where: { tenantId, siren },
    orderBy: { sentAt: "desc" },
    take: limit,
    select: {
      id: true,
      direction: true,
      subject: true,
      fromEmail: true,
      toEmails: true,
      sentAt: true,
      sentStatus: true,
      bodyText: true,
    },
  });
}
