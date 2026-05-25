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
  /** Signature HTML appendée aux mails sortants (migration 0030 §J). */
  mailSignatureHtml: string | null;
  mailSignatureEnabled: boolean;
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
    mailSignatureHtml: row.mailSignatureHtml,
    mailSignatureEnabled: row.mailSignatureEnabled,
  };
}

/** Met à jour la signature mail du tenant. */
export async function updateMailSignature(
  tenantId: string,
  input: { mailSignatureHtml: string | null; mailSignatureEnabled: boolean },
): Promise<MailConfigPublic> {
  await prisma.tenantMailConfig.upsert({
    where: { tenantId },
    update: {
      mailSignatureHtml: input.mailSignatureHtml,
      mailSignatureEnabled: input.mailSignatureEnabled,
    },
    create: {
      tenantId,
      mailSignatureHtml: input.mailSignatureHtml,
      mailSignatureEnabled: input.mailSignatureEnabled,
    },
  });
  const fresh = await getMailConfigPublic(tenantId);
  return fresh!;
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

// ─── IMAP réception v2 (W8b 2026-05-25) ─────────────────────────────────────

/** Vue safe pour le client UI (onglet IMAP de /settings/mail). Pas de password. */
export interface ImapConfigPublic {
  host: string | null;
  port: number | null;
  username: string | null;
  tls: boolean;
  folder: string;
  /** True si imap_password_enc est stocké. UI affiche "•••". */
  passwordConfigured: boolean;
  lastUidSeen: number | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}

/** Vue interne avec passwordEnc — usage strictement serveur (fetch IMAP). */
export interface ImapConfigInternal {
  tenantId: string;
  host: string;
  port: number;
  username: string;
  passwordEnc: string;
  tls: boolean;
  folder: string;
  lastUidSeen: number | null;
}

/** Lit la config IMAP d'un tenant en vue publique. */
export async function getImapConfigPublic(
  tenantId: string,
): Promise<ImapConfigPublic | null> {
  const row = await prisma.tenantMailConfig.findUnique({
    where: { tenantId },
  });
  if (!row) return null;
  return {
    host: row.imapHost,
    port: row.imapPort,
    username: row.imapUsername,
    tls: row.imapTls,
    folder: row.imapFolder,
    passwordConfigured: isPasswordConfigured(row.imapPasswordEnc),
    lastUidSeen: row.imapLastUidSeen,
    lastSyncAt: row.imapLastSyncAt?.toISOString() ?? null,
    lastSyncStatus: row.imapLastSyncStatus,
    lastSyncError: row.imapLastSyncError,
  };
}

/** Lit la config IMAP d'un tenant en vue interne (avec passwordEnc). */
export async function getImapConfigInternal(
  tenantId: string,
): Promise<ImapConfigInternal | null> {
  const row = await prisma.tenantMailConfig.findUnique({
    where: { tenantId },
  });
  if (
    !row ||
    !row.imapHost ||
    !row.imapPort ||
    !row.imapUsername ||
    !row.imapPasswordEnc
  ) {
    return null;
  }
  return {
    tenantId,
    host: row.imapHost,
    port: row.imapPort,
    username: row.imapUsername,
    passwordEnc: row.imapPasswordEnc,
    tls: row.imapTls,
    folder: row.imapFolder,
    lastUidSeen: row.imapLastUidSeen,
  };
}

/** Liste tous les tenants avec une config IMAP exploitable — pour le cron. */
export async function listImapEnabledTenants(): Promise<ImapConfigInternal[]> {
  const rows = await prisma.tenantMailConfig.findMany({
    where: {
      imapHost: { not: null },
      imapPort: { not: null },
      imapUsername: { not: null },
      imapPasswordEnc: { not: null },
    },
    select: {
      tenantId: true,
      imapHost: true,
      imapPort: true,
      imapUsername: true,
      imapPasswordEnc: true,
      imapTls: true,
      imapFolder: true,
      imapLastUidSeen: true,
    },
  });
  return rows
    .filter((r) => r.imapHost && r.imapPort && r.imapUsername && r.imapPasswordEnc)
    .map((r) => ({
      tenantId: r.tenantId,
      host: r.imapHost!,
      port: r.imapPort!,
      username: r.imapUsername!,
      passwordEnc: r.imapPasswordEnc!,
      tls: r.imapTls,
      folder: r.imapFolder,
      lastUidSeen: r.imapLastUidSeen,
    }));
}

export interface UpsertImapConfigInput {
  host: string;
  port: number;
  username: string;
  /** Plaintext password. Si undefined, ne touche pas le password existant. */
  password?: string;
  tls: boolean;
  folder: string;
}

/** Upsert la config IMAP d'un tenant. Chiffre le password à la volée.
 *  Reset volontairement `imapLastUidSeen` à null si on change `host`+`username` —
 *  ça évite de zapper des mails sur un compte fraîchement reconnecté. */
export async function upsertImapConfig(
  tenantId: string,
  input: UpsertImapConfigInput,
): Promise<ImapConfigPublic> {
  const passwordEnc =
    input.password && input.password.length > 0
      ? encryptPassword(input.password)
      : undefined;

  // Vérifie si on change de compte → reset high-water mark.
  const existing = await prisma.tenantMailConfig.findUnique({
    where: { tenantId },
    select: { imapHost: true, imapUsername: true },
  });
  const accountChanged = !!existing && (
    existing.imapHost !== input.host || existing.imapUsername !== input.username
  );

  await prisma.tenantMailConfig.upsert({
    where: { tenantId },
    update: {
      imapHost: input.host,
      imapPort: input.port,
      imapUsername: input.username,
      ...(passwordEnc !== undefined ? { imapPasswordEnc: passwordEnc } : {}),
      imapTls: input.tls,
      imapFolder: input.folder,
      ...(accountChanged ? { imapLastUidSeen: null } : {}),
    },
    create: {
      tenantId,
      imapHost: input.host,
      imapPort: input.port,
      imapUsername: input.username,
      imapPasswordEnc: passwordEnc ?? null,
      imapTls: input.tls,
      imapFolder: input.folder,
    },
  });
  const fresh = await getImapConfigPublic(tenantId);
  return fresh!;
}

/** Efface les credentials IMAP du tenant (UI : bouton "Désactiver IMAP"). */
export async function clearImapConfig(tenantId: string): Promise<void> {
  await prisma.tenantMailConfig.update({
    where: { tenantId },
    data: {
      imapHost: null,
      imapPort: null,
      imapUsername: null,
      imapPasswordEnc: null,
      imapLastUidSeen: null,
      imapLastSyncAt: null,
      imapLastSyncStatus: null,
      imapLastSyncError: null,
    },
  });
}

/** Persist le résultat d'un sync (cron ou test). */
export async function recordImapSyncResult(
  tenantId: string,
  opts: {
    status: string;
    error: string | null;
    lastUidSeen?: number | null;
  },
): Promise<void> {
  await prisma.tenantMailConfig.update({
    where: { tenantId },
    data: {
      imapLastSyncAt: new Date(),
      imapLastSyncStatus: opts.status,
      imapLastSyncError: opts.error,
      ...(opts.lastUidSeen !== undefined && opts.lastUidSeen !== null
        ? { imapLastUidSeen: opts.lastUidSeen }
        : {}),
    },
  });
}

export interface RecordIncomingEmailInput {
  tenantId: string;
  siren: string | null;
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: Date;
}

/**
 * Insère un mail entrant dans lead_emails. Idempotent grâce au UNIQUE
 * sur message_id (cf migration 0022) : si le même message_id est déjà
 * inséré (même run, autre cron, retry…), on swallow le P2002 et on
 * retourne false.
 *
 * direction = "incoming", sent_status = "received" (nouveau statut).
 */
export async function recordIncomingEmail(
  input: RecordIncomingEmailInput,
): Promise<boolean> {
  try {
    await prisma.leadEmail.create({
      data: {
        tenantId: input.tenantId,
        siren: input.siren,
        direction: "incoming",
        messageId: input.messageId,
        inReplyTo: input.inReplyTo,
        references: input.references,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        toEmails: input.toEmails,
        ccEmails: input.ccEmails,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        sentStatus: "received",
        sentAt: input.receivedAt,
      },
    });
    return true;
  } catch (err) {
    // P2002 = unique constraint violation sur message_id → duplicate, attendu.
    const code = (err as { code?: string }).code;
    if (code === "P2002") return false;
    throw err;
  }
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
