/**
 * Mail outbox — enqueue + flush (ticket follow-ups §F).
 *
 * Pattern transactional outbox similaire à lib/hub-webhook/outbox.ts.
 *
 *  - `enqueueMail(tx, input)` : INSERT mail_outbox + lead_emails(queued)
 *    dans la MÊME transaction Prisma. Garantit qu'on ne crée pas un
 *    placeholder UI sans la row outbox qui ira le mettre à jour.
 *
 *  - `flushOutbox(opts?)` : SELECT FOR UPDATE SKIP LOCKED, exécute le
 *    send via lib/mail/smtp.ts, met à jour status + bump lead_emails.
 *    Appelé par /api/cron/mail-outbox-flush toutes les 1 min.
 *
 * Retry exponential (millisecondes) :
 *   attempt 1 fail → 1 min
 *   attempt 2 fail → 5 min
 *   attempt 3 fail → 15 min
 *   attempt 4 fail → 60 min
 *   attempt 5 fail → 24 h → 'failed' (sortie de la file)
 *
 * Concurrence : SELECT FOR UPDATE SKIP LOCKED tolère N workers en
 * parallèle sans double-envoi. Au pire un mail est tenté 2× — le
 * destinataire reçoit 2 copies, ce qui est acceptable vs. perte
 * silencieuse (idempotency garantie côté caller via idempotency_key).
 */
import { randomUUID } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { sendMail, type SmtpCredentials, type SendResult } from "@/lib/mail/smtp";
import { getMailConfigInternal } from "@/lib/mail/queries";

export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export const MAIL_OUTBOX_MAX_ATTEMPTS = 5;

const RETRY_DELAYS_MS = [
  60_000,        // 1 min
  5 * 60_000,    // 5 min
  15 * 60_000,   // 15 min
  60 * 60_000,   // 60 min
  24 * 60 * 60_000, // 24 h
];

/**
 * Délai avant le prochain retry, exprimé en ms.
 * `attempts` = nombre d'essais déjà comptés (1 après le premier échec).
 * Retour : 0 si attempts <= 0, sinon RETRY_DELAYS_MS[attempts-1], capé.
 */
export function nextRetryDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  const idx = Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[idx];
}

export interface MailOutboxPayload {
  to: string;
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  templateSlug: string | null;
  siren: string | null;
  /** "smtp" — gmail-via-hub n'utilise pas l'outbox local (Hub queue lui-même). */
  provider: "smtp";
  fromEmail: string;
  fromName: string | null;
}

export interface EnqueueMailInput {
  tenantId: string;
  userId: string | null;
  workspaceId: string | null;
  payload: MailOutboxPayload;
  /** Idempotency key — si fourni, dédup côté outbox. Sinon UUID frais. */
  idempotencyKey?: string;
}

export interface EnqueueMailResult {
  outboxId: string;
  leadEmailId: string;
  idempotencyKey: string;
  /** true si l'idempotency_key correspondait déjà à un row existant. */
  alreadyEnqueued: boolean;
}

/**
 * Enqueue un mail (INSERT outbox + lead_emails placeholder). À appeler
 * dans une `prisma.$transaction` pour atomicité.
 *
 * Si `idempotencyKey` est fourni et matche un row existant → on retourne
 * { alreadyEnqueued: true, outboxId existant } sans rien créer. Pattern
 * Stripe : un caller qui retry sa requête HTTP ne génère pas 2 mails.
 */
export async function enqueueMail(
  tx: PrismaLike,
  input: EnqueueMailInput,
): Promise<EnqueueMailResult> {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  // Dédup explicite avant l'INSERT — évite de polluer les logs avec un
  // P2002 quand un caller retry naturellement. On lit puis on retourne
  // l'existant si déjà là.
  const existing = await tx.mailOutbox.findUnique({
    where: { idempotencyKey },
    select: { id: true, leadEmailId: true },
  });
  if (existing) {
    return {
      outboxId: existing.id,
      leadEmailId: existing.leadEmailId ?? "",
      idempotencyKey,
      alreadyEnqueued: true,
    };
  }

  // 1) Placeholder lead_emails(sent_status='queued') — la timeline 360°
  //    voit immédiatement le mail "en attente d'envoi".
  const placeholderMessageId = `queued-${idempotencyKey}`;
  const leadEmail = await tx.leadEmail.create({
    data: {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      siren: input.payload.siren,
      direction: "outgoing",
      messageId: placeholderMessageId,
      fromEmail: input.payload.fromEmail,
      fromName: input.payload.fromName,
      toEmails: [input.payload.to],
      ccEmails: input.payload.cc ?? [],
      subject: input.payload.subject,
      bodyText: input.payload.bodyText,
      bodyHtml: input.payload.bodyHtml,
      templateSlug: input.payload.templateSlug,
      sentStatus: "queued",
    },
    select: { id: true },
  });

  // 2) Row outbox liée — c'est elle qui pilotera les retries.
  const outbox = await tx.mailOutbox.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      leadEmailId: leadEmail.id,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      idempotencyKey,
      status: "queued",
      attempts: 0,
    },
    select: { id: true },
  });

  return {
    outboxId: outbox.id,
    leadEmailId: leadEmail.id,
    idempotencyKey,
    alreadyEnqueued: false,
  };
}

export interface FlushOutboxResult {
  picked: number;
  sent: number;
  failedRetry: number;
  failed: number;
}

export interface FlushOutboxOptions {
  /** Max rows par appel. Default 25. */
  batchSize?: number;
  /** Prisma client à utiliser. Override pour tests. */
  prisma?: PrismaClient;
  /**
   * Override fonction send (DI pour tests sans monkeypatch global). Reçoit
   * le payload + les creds résolus pour le tenant ; retourne un SendResult
   * standard de lib/mail/smtp.ts.
   */
  send?: (
    creds: SmtpCredentials,
    payload: MailOutboxPayload,
  ) => Promise<SendResult>;
  /** Override resolver creds (DI pour tests sans seed DB). */
  resolveCreds?: (tenantId: string) => Promise<SmtpCredentials | null>;
  /** Override now() pour les tests de retry timing. */
  now?: () => Date;
}

interface OutboxRowRaw {
  id: string;
  tenant_id: string;
  lead_email_id: string | null;
  payload: unknown;
  attempts: number;
}

/**
 * Worker : consomme un batch de mails éligibles. Idempotent + concurrence-safe
 * via SELECT FOR UPDATE SKIP LOCKED.
 *
 * Pour chaque row :
 *  - resolveCreds(tenantId) → si null → status='failed' immédiat (la config
 *    SMTP a été supprimée entre l'enqueue et le flush, pas la peine de retry).
 *  - sendMail(creds, payload) → result.ok ? 'sent' + bump lead_emails(messageId)
 *    : retry exponential ou 'failed' si max attempts.
 */
export async function flushOutbox(
  opts: FlushOutboxOptions = {},
): Promise<FlushOutboxResult> {
  const client = opts.prisma ?? (defaultPrisma as PrismaClient);
  const batchSize = opts.batchSize ?? 25;
  const defaultSend = (creds: SmtpCredentials, payload: MailOutboxPayload) =>
    sendMail(creds, {
      to: payload.to,
      cc: payload.cc,
      subject: payload.subject,
      bodyText: payload.bodyText,
      bodyHtml: payload.bodyHtml,
    });
  const send = opts.send ?? defaultSend;
  const defaultResolveCreds = (tenantId: string) =>
    getMailConfigInternal(tenantId);
  const resolveCreds = opts.resolveCreds ?? defaultResolveCreds;
  const defaultNow = () => new Date();
  const now = opts.now ?? defaultNow;

  const result: FlushOutboxResult = {
    picked: 0,
    sent: 0,
    failedRetry: 0,
    failed: 0,
  };

  // Lock concurrent-safe : SELECT FOR UPDATE SKIP LOCKED + UPDATE status='sending'
  // pour signaler aux autres workers. Identique au pattern hub-webhook.
  const picked = await client.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<OutboxRowRaw[]>(
      `
        SELECT id, tenant_id, lead_email_id, payload, attempts
        FROM mail_outbox
        WHERE status IN ('queued', 'failed_retry')
          AND next_retry_at <= NOW()
        ORDER BY next_retry_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `,
      batchSize,
    );

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    await tx.mailOutbox.updateMany({
      where: { id: { in: ids } },
      data: { status: "sending" },
    });

    return rows;
  });

  result.picked = picked.length;
  if (picked.length === 0) return result;

  for (const row of picked) {
    const payload = extractPayload(row.payload);
    if (!payload) {
      // Payload corrompu — sortie définitive (pas de retry possible).
      await client.mailOutbox.update({
        where: { id: row.id },
        data: {
          status: "failed",
          lastError: "payload_corrupted",
          attempts: { increment: 1 },
        },
      });
      result.failed++;
      if (row.lead_email_id) {
        await client.leadEmail
          .update({
            where: { id: row.lead_email_id },
            data: { sentStatus: "failed", sentError: "payload_corrupted" },
          })
          .catch(() => {});
      }
      continue;
    }

    const creds = await resolveCreds(row.tenant_id);
    if (!creds) {
      // Plus de config SMTP — pas de retry possible, sortie immédiate.
      const nextAttempts = row.attempts + 1;
      await client.mailOutbox.update({
        where: { id: row.id },
        data: {
          status: "failed",
          attempts: nextAttempts,
          lastError: "missing_credentials",
        },
      });
      result.failed++;
      if (row.lead_email_id) {
        await client.leadEmail
          .update({
            where: { id: row.lead_email_id },
            data: { sentStatus: "failed", sentError: "missing_credentials" },
          })
          .catch(() => {});
      }
      continue;
    }

    // Append signature si configurée et activée. La lecture est faite ici
    // (pas au moment de l'enqueue) pour que toute modif de signature
    // s'applique aux mails en queue — c'est ce que l'user attend ("je
    // change ma signature, les mails à partir de maintenant l'utilisent").
    const signed = await applySignatureIfEnabled(client, row.tenant_id, payload);

    const attempt = await send(creds, signed);

    if (attempt.ok && attempt.messageId) {
      await client.mailOutbox.update({
        where: { id: row.id },
        data: {
          status: "sent",
          sentAt: now(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });
      if (row.lead_email_id) {
        await client.leadEmail
          .update({
            where: { id: row.lead_email_id },
            data: {
              sentStatus: "sent",
              sentAt: now(),
              messageId: attempt.messageId,
              bodyHtml: signed.bodyHtml,
              bodyText: signed.bodyText,
            },
          })
          .catch(() => {});
      }
      result.sent++;
      continue;
    }

    const nextAttempts = row.attempts + 1;
    const errMsg = attempt.errorMessage ?? attempt.reason ?? "unknown";

    if (nextAttempts >= MAIL_OUTBOX_MAX_ATTEMPTS) {
      await client.mailOutbox.update({
        where: { id: row.id },
        data: {
          status: "failed",
          attempts: nextAttempts,
          lastError: errMsg,
        },
      });
      result.failed++;
      if (row.lead_email_id) {
        await client.leadEmail
          .update({
            where: { id: row.lead_email_id },
            data: {
              sentStatus: "failed",
              sentError: errMsg,
            },
          })
          .catch(() => {});
      }
      console.error(
        `[mail-outbox:failed] tenant=${row.tenant_id} id=${row.id} attempts=${nextAttempts} reason=${attempt.reason}`,
      );
    } else {
      const delay = nextRetryDelayMs(nextAttempts);
      await client.mailOutbox.update({
        where: { id: row.id },
        data: {
          status: "failed_retry",
          attempts: nextAttempts,
          nextRetryAt: new Date(now().getTime() + delay),
          lastError: errMsg,
        },
      });
      result.failedRetry++;
    }
  }

  return result;
}

function extractPayload(raw: unknown): MailOutboxPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (
    typeof p.to !== "string" ||
    typeof p.subject !== "string" ||
    typeof p.bodyText !== "string" ||
    typeof p.bodyHtml !== "string" ||
    typeof p.fromEmail !== "string"
  ) {
    return null;
  }
  return {
    to: p.to,
    cc: Array.isArray(p.cc) ? (p.cc as string[]) : undefined,
    subject: p.subject,
    bodyText: p.bodyText,
    bodyHtml: p.bodyHtml,
    templateSlug: typeof p.templateSlug === "string" ? p.templateSlug : null,
    siren: typeof p.siren === "string" ? p.siren : null,
    provider: "smtp",
    fromEmail: p.fromEmail,
    fromName: typeof p.fromName === "string" ? p.fromName : null,
  };
}

/**
 * Append signature_html / signature_text au payload si configuré + activé.
 * Retourne le payload modifié (clone shallow) — laisse l'original intact.
 *
 * La signature est lue depuis tenant_mail_config (migration 0030). Si elle
 * est NULL ou si mail_signature_enabled=false → no-op.
 */
export async function applySignatureIfEnabled(
  client: PrismaClient,
  tenantId: string,
  payload: MailOutboxPayload,
): Promise<MailOutboxPayload> {
  const cfg = await client.tenantMailConfig.findUnique({
    where: { tenantId },
    select: {
      mailSignatureHtml: true,
      mailSignatureEnabled: true,
    },
  });
  if (!cfg || !cfg.mailSignatureEnabled) return payload;
  const sig = (cfg.mailSignatureHtml ?? "").trim();
  if (!sig) return payload;

  // bodyHtml : append séparateur + signature HTML.
  // bodyText : append signature en plain text (strip HTML basique).
  const signatureText = stripHtml(sig);
  return {
    ...payload,
    bodyHtml: `${payload.bodyHtml}<br><br><div class="veridian-mail-signature">${sig}</div>`,
    bodyText: `${payload.bodyText}\n\n--\n${signatureText}`,
  };
}

/** Strip HTML tags pour le fallback text — naïf mais suffisant pour signature. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
