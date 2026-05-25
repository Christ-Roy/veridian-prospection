/**
 * Wrapper IMAP imapflow pour Prospection — v2 réception polling (cron 5 min).
 *
 * Pattern best-effort à la SMTP (cf src/lib/mail/smtp.ts) : retourne un
 * résultat structuré `{ ok, messages?, reason?, lastUid? }` plutôt que de
 * throw — le cron alimente directement `tenant_mail_config.imap_last_sync_*`.
 *
 * Cadrage Robert 2026-05-25 : pas de worker container BullMQ. Connexion
 * éphémère par run (open → fetch UID > last_uid_seen → close). 30s timeout
 * dur sur le handshake + auth.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { decryptPassword } from "@/lib/crypto/encrypt-password";

const DEFAULT_TIMEOUT_MS = 30_000;
/** Garde-fou : on ne fetch jamais plus de N nouveaux UIDs par run pour ne pas
 *  bloquer le cron sur un tenant qui a accumulé 50k mails non lus. Au-delà,
 *  on prend les N les plus récents et on saute en avant. */
const MAX_MESSAGES_PER_RUN = 200;

export interface ImapCredentials {
  host: string;
  port: number;
  username: string;
  /** Déjà chiffré AES-256-GCM en DB (imap_password_enc). */
  passwordEnc: string;
  /** true = TLS direct (993). false = plain ou STARTTLS (143). */
  tls: boolean;
  /** Dossier à scanner (ex: "INBOX"). */
  folder: string;
}

export type ImapReason =
  | "missing_credentials"
  | "decrypt_failed"
  | "auth_failed"
  | "host_unreachable"
  | "timeout"
  | "tls_error"
  | "folder_not_found"
  | "unknown";

/** Mail entrant parsé prêt à être inséré dans lead_emails. */
export interface IncomingMessage {
  /** UID IMAP (entier monotone par dossier). */
  uid: number;
  /** Header Message-ID (sans `<>`) ou fallback `imap-uid-<uid>@<host>`. */
  messageId: string;
  /** Header In-Reply-To (sans `<>`) si présent. */
  inReplyTo: string | null;
  /** Header References concaténé si présent. */
  references: string | null;
  /** Adresse expéditeur normalisée (lowercase). null si parsing fail. */
  fromEmail: string | null;
  /** Nom affiché expéditeur si fourni. */
  fromName: string | null;
  /** Destinataires To: normalisés. */
  toEmails: string[];
  /** CC normalisés. */
  ccEmails: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  /** Date du header Date: (fallback now si absent). */
  receivedAt: Date;
}

export interface ImapFetchResult {
  ok: boolean;
  reason?: ImapReason;
  errorMessage?: string;
  messages: IncomingMessage[];
  /** UID le plus grand vu sur ce run. À persister dans imap_last_uid_seen. */
  lastUid: number | null;
}

/** Mappe une erreur ImapFlow → reason structuré pour l'UI / le cron. */
export function classifyImapError(err: unknown): { reason: ImapReason; message: string } {
  const e = err as { code?: string; authenticationFailed?: boolean; message?: string };
  const message = e.message ?? String(err);
  const code = e.code;

  if (e.authenticationFailed || /auth|LOGIN failed|invalid credentials/i.test(message)) {
    return { reason: "auth_failed", message };
  }
  if (code === "ETIMEDOUT" || /timeout/i.test(message)) {
    return { reason: "timeout", message };
  }
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH") {
    return { reason: "host_unreachable", message };
  }
  if (/tls|ssl|certificate/i.test(message)) {
    return { reason: "tls_error", message };
  }
  if (/no such mailbox|folder/i.test(message)) {
    return { reason: "folder_not_found", message };
  }
  return { reason: "unknown", message };
}

/** Crée un client ImapFlow typé. Séparé pour faciliter le mock en tests. */
export function createImapClient(creds: ImapCredentials): ImapFlow {
  let password: string;
  try {
    password = decryptPassword(creds.passwordEnc);
  } catch (err) {
    throw new Error(
      `IMAP password decryption failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.tls && creds.port === 993,
    auth: { user: creds.username, pass: password },
    // Bloque imapflow d'écrire en stderr — déjà loggé via classifyImapError.
    logger: false,
    // Timeout réseau global ; ImapFlow appelle ce setting sur le socket.
    socketTimeout: DEFAULT_TIMEOUT_MS,
  });
}

function normalizeMessageId(raw: string | null | undefined, fallbackHost: string, uid: number): string {
  if (!raw) return `imap-uid-${uid}@${fallbackHost}`;
  // Strip eventuels `<` `>` + whitespace.
  return raw.replace(/^[<\s]+|[>\s]+$/g, "").slice(0, 255);
}

function normalizeAddrList(list: { value?: Array<{ address?: string }> } | undefined): string[] {
  if (!list?.value) return [];
  return list.value
    .map((a) => (a.address ?? "").trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * Fetch les nouveaux mails depuis `lastUidSeen` (exclusif). Ne throw jamais —
 * retourne un ImapFetchResult que le caller mappe en imap_last_sync_status.
 *
 * Idempotent : si on rappelle avec le même lastUidSeen, on refetch les mêmes
 * UIDs. La déduplication est faite en DB via lead_emails.message_id UNIQUE
 * (cf migration 0022) + INSERT ... ON CONFLICT DO NOTHING.
 */
export async function fetchNewMessages(
  creds: ImapCredentials,
  lastUidSeen: number | null,
): Promise<ImapFetchResult> {
  if (!creds.host || !creds.port || !creds.username || !creds.passwordEnc) {
    return { ok: false, reason: "missing_credentials", messages: [], lastUid: null };
  }

  let client: ImapFlow;
  try {
    client = createImapClient(creds);
  } catch (err) {
    return {
      ok: false,
      reason: "decrypt_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      messages: [],
      lastUid: null,
    };
  }

  try {
    await client.connect();
  } catch (err) {
    const { reason, message } = classifyImapError(err);
    return { ok: false, reason, errorMessage: message, messages: [], lastUid: null };
  }

  const messages: IncomingMessage[] = [];
  let maxUid = lastUidSeen ?? 0;

  try {
    const lock = await client.getMailboxLock(creds.folder);
    try {
      // Construit la range UID : "<last+1>:*" en mode incrémental, "1:*" cold.
      const range = lastUidSeen !== null && lastUidSeen > 0
        ? `${lastUidSeen + 1}:*`
        : "1:*";

      // Liste les UIDs candidates d'abord ; tronque à MAX_MESSAGES_PER_RUN.
      const uids: number[] = [];
      for await (const msg of client.fetch(range, { uid: true }, { uid: true })) {
        if (typeof msg.uid === "number") uids.push(msg.uid);
      }
      uids.sort((a, b) => a - b);
      // Garde au plus N les plus récents si déluge.
      const slice = uids.length > MAX_MESSAGES_PER_RUN
        ? uids.slice(uids.length - MAX_MESSAGES_PER_RUN)
        : uids;

      for (const uid of slice) {
        try {
          const raw = await client.fetchOne(
            uid,
            { source: true, envelope: true },
            { uid: true },
          );
          if (!raw || !raw.source) continue;

          const parsed = await simpleParser(raw.source as Buffer);

          const fromAddr = parsed.from?.value?.[0];
          const fromEmail = fromAddr?.address ? fromAddr.address.toLowerCase() : null;
          const fromName = fromAddr?.name ? String(fromAddr.name).slice(0, 120) : null;

          // mailparser type pour `to` peut être un AddressObject | AddressObject[]
          const toRaw = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to;
          const ccRaw = Array.isArray(parsed.cc) ? parsed.cc[0] : parsed.cc;
          const toEmails = normalizeAddrList(toRaw);
          const ccEmails = normalizeAddrList(ccRaw);

          const messageId = normalizeMessageId(parsed.messageId ?? null, creds.host, uid);
          const inReplyTo = parsed.inReplyTo
            ? parsed.inReplyTo.replace(/^[<\s]+|[>\s]+$/g, "").slice(0, 255)
            : null;
          const references = Array.isArray(parsed.references)
            ? parsed.references.join(" ").slice(0, 2000)
            : typeof parsed.references === "string"
              ? parsed.references.slice(0, 2000)
              : null;

          messages.push({
            uid,
            messageId,
            inReplyTo,
            references,
            fromEmail,
            fromName,
            toEmails,
            ccEmails,
            subject: parsed.subject ? parsed.subject.slice(0, 500) : null,
            bodyText: parsed.text ?? null,
            bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
            receivedAt: parsed.date ?? new Date(),
          });
          if (uid > maxUid) maxUid = uid;
        } catch (innerErr) {
          // Mail individuel non parsable : on log et on continue, on ne casse
          // pas le run pour 1 mail mal formé.
          console.warn(
            `[imap-client] parse UID ${uid} failed: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`,
          );
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    const { reason, message } = classifyImapError(err);
    try { await client.logout(); } catch { /* best-effort close */ }
    return { ok: false, reason, errorMessage: message, messages, lastUid: maxUid || null };
  }

  try { await client.logout(); } catch { /* best-effort close */ }

  return {
    ok: true,
    messages,
    lastUid: maxUid > 0 ? maxUid : null,
  };
}

/**
 * Test la connexion IMAP (handshake + auth + open folder) sans fetcher.
 * Utilisé par /api/mail/test-imap-connection (bouton "Tester la connexion"
 * dans /settings/mail onglet IMAP).
 */
export async function testImapConnection(creds: ImapCredentials): Promise<{
  ok: boolean;
  reason?: ImapReason;
  errorMessage?: string;
}> {
  if (!creds.host || !creds.port || !creds.username || !creds.passwordEnc) {
    return { ok: false, reason: "missing_credentials" };
  }

  let client: ImapFlow;
  try {
    client = createImapClient(creds);
  } catch (err) {
    return {
      ok: false,
      reason: "decrypt_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await client.connect();
    const lock = await client.getMailboxLock(creds.folder);
    lock.release();
    await client.logout();
    return { ok: true };
  } catch (err) {
    try { await client.logout(); } catch { /* best-effort */ }
    const { reason, message } = classifyImapError(err);
    return { ok: false, reason, errorMessage: message };
  }
}
