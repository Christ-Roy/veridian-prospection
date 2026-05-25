/**
 * Helper E2E pour seed / cleanup de la config IMAP du tenant canonique.
 *
 * Cf mail-config.ts pour le tenant E2E (e2e0e2e0-0000-4000-8000-000000000002).
 * On passe par l'API PUT /api/mail/imap-config (et non INSERT direct) pour
 * que le password soit chiffré avec le même AUTH_SECRET que l'app — sinon
 * decrypt KO en runtime.
 */
import { PrismaClient } from "@prisma/client";
import type { Page } from "@playwright/test";

const E2E_TENANT_ID = "e2e0e2e0-0000-4000-8000-000000000002";

let prismaSingleton: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
}

export interface ImapConfigInput {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
  folder?: string;
}

/** Seed la config IMAP du tenant E2E via l'API PUT. Requiert login préalable. */
export async function seedImapConfig(
  page: Page,
  baseUrl: string,
  cfg: ImapConfigInput,
): Promise<void> {
  const res = await page.request.put(`${baseUrl}/api/mail/imap-config`, {
    data: {
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      tls: cfg.tls,
      folder: cfg.folder ?? "INBOX",
    },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `[imap-config] PUT /api/mail/imap-config a échoué (${res.status()}): ${body}`,
    );
  }
}

/** Efface la config IMAP du tenant E2E (cleanup). */
export async function clearImapConfig(): Promise<void> {
  const prisma = getPrisma();
  await prisma.tenantMailConfig
    .updateMany({
      where: { tenantId: E2E_TENANT_ID },
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
    })
    .catch(() => {});
}

/** Lit l'état IMAP brut du tenant E2E (sync_status, last_uid_seen, etc.). */
export async function readImapState(): Promise<{
  imapHost: string | null;
  imapPasswordEnc: string | null;
  imapLastUidSeen: number | null;
  imapLastSyncStatus: string | null;
  imapLastSyncError: string | null;
  imapFolder: string;
} | null> {
  const prisma = getPrisma();
  const row = await prisma.tenantMailConfig.findUnique({
    where: { tenantId: E2E_TENANT_ID },
    select: {
      imapHost: true,
      imapPasswordEnc: true,
      imapLastUidSeen: true,
      imapLastSyncStatus: true,
      imapLastSyncError: true,
      imapFolder: true,
    },
  });
  return row;
}

/** Insère un lead_emails incoming directement en DB — utilisé pour les
 *  specs qui veulent valider la lecture (timeline 360°) sans dépendre du
 *  vrai serveur IMAP (test isolation). */
export async function insertIncomingLeadEmail(opts: {
  messageId: string;
  fromEmail: string;
  siren?: string | null;
  subject?: string;
  bodyText?: string;
  inReplyTo?: string;
  references?: string;
}): Promise<string> {
  const prisma = getPrisma();
  const row = await prisma.leadEmail.create({
    data: {
      tenantId: E2E_TENANT_ID,
      siren: opts.siren ?? null,
      direction: "incoming",
      messageId: opts.messageId,
      inReplyTo: opts.inReplyTo ?? null,
      references: opts.references ?? null,
      fromEmail: opts.fromEmail,
      fromName: null,
      toEmails: ["user@example.com"],
      ccEmails: [],
      subject: opts.subject ?? null,
      bodyText: opts.bodyText ?? "(no body)",
      bodyHtml: null,
      sentStatus: "received",
      sentAt: new Date(),
    },
    select: { id: true },
  });
  return row.id;
}

/** Compte les lead_emails incoming du tenant E2E. */
export async function countIncomingEmails(opts: { siren?: string } = {}): Promise<number> {
  const prisma = getPrisma();
  return prisma.leadEmail.count({
    where: {
      tenantId: E2E_TENANT_ID,
      direction: "incoming",
      siren: opts.siren,
    },
  });
}

/** Cleanup : supprime tous les incoming du tenant E2E. */
export async function purgeIncomingEmails(): Promise<void> {
  const prisma = getPrisma();
  await prisma.leadEmail.deleteMany({
    where: { tenantId: E2E_TENANT_ID, direction: "incoming" },
  });
}

/** Force last_uid_seen pour tester l'incrémental. */
export async function setImapLastUid(uid: number | null): Promise<void> {
  const prisma = getPrisma();
  await prisma.tenantMailConfig.update({
    where: { tenantId: E2E_TENANT_ID },
    data: { imapLastUidSeen: uid },
  });
}
