/**
 * Helper mailpit pour les specs E2E mail.
 *
 * Mailpit = serveur SMTP local + UI/API qui capture les mails sans envoyer.
 * Tourne sur dev-pub réseau staging-edge (hostname `mailpit-staging`, port
 * 1025 SMTP, port 8025 HTTP API).
 *
 * API utilisée :
 *   - GET  /api/v1/info               → uptime + count messages
 *   - GET  /api/v1/messages           → liste messages (paginated)
 *   - GET  /api/v1/message/{id}       → détail d'un message
 *   - DELETE /api/v1/messages         → purge la mailbox
 *
 * Doc : https://github.com/axllent/mailpit/blob/develop/docs/apiv1/README.md
 */
const MAILPIT_HTTP =
  process.env.MAILPIT_HTTP_URL || "http://mailpit-staging:8025";

export interface MailpitMessageSummary {
  ID: string;
  MessageID: string;
  From: { Address: string; Name: string };
  To: Array<{ Address: string; Name: string }>;
  Subject: string;
  Created: string;
  Snippet: string;
}

export interface MailpitMessage {
  ID: string;
  MessageID: string;
  From: { Address: string; Name: string };
  To: Array<{ Address: string; Name: string }>;
  Subject: string;
  Text: string;
  HTML: string;
  Date: string;
}

/** Récupère la liste des messages stockés dans mailpit. */
export async function listMessages(): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${MAILPIT_HTTP}/api/v1/messages`);
  if (!res.ok) {
    throw new Error(`Mailpit listMessages KO: ${res.status}`);
  }
  const data = (await res.json()) as { messages: MailpitMessageSummary[] };
  return data.messages ?? [];
}

/** Récupère le détail d'un message par son ID interne mailpit. */
export async function getMessage(id: string): Promise<MailpitMessage> {
  const res = await fetch(`${MAILPIT_HTTP}/api/v1/message/${id}`);
  if (!res.ok) {
    throw new Error(`Mailpit getMessage(${id}) KO: ${res.status}`);
  }
  return (await res.json()) as MailpitMessage;
}

/** Purge tous les messages de la mailbox mailpit (entre 2 specs). */
export async function purgeMailbox(): Promise<void> {
  const res = await fetch(`${MAILPIT_HTTP}/api/v1/messages`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Mailpit purge KO: ${res.status}`);
  }
}

/**
 * Attend l'arrivée d'au moins 1 message destiné à `toEmail`. Poll toutes
 * les 500ms jusqu'au timeout. Throw si rien n'arrive — pas de soft fail.
 */
export async function waitForMessageTo(
  toEmail: string,
  opts: { timeoutMs?: number } = {},
): Promise<MailpitMessage> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  let lastCount = 0;
  while (Date.now() < deadline) {
    const messages = await listMessages();
    lastCount = messages.length;
    const match = messages.find((m) =>
      m.To.some((t) => t.Address.toLowerCase() === toEmail.toLowerCase()),
    );
    if (match) {
      return await getMessage(match.ID);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `[mailpit] Aucun message reçu pour ${toEmail} en ${timeoutMs}ms ` +
      `(mailbox count=${lastCount})`,
  );
}

/** Confirme que mailpit est UP — à appeler en début de spec pour fail fast. */
export async function assertMailpitUp(): Promise<void> {
  try {
    const res = await fetch(`${MAILPIT_HTTP}/api/v1/info`);
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
  } catch (err) {
    throw new Error(
      `[mailpit] Pas joignable à ${MAILPIT_HTTP} — lance le container ` +
        `via scripts/e2e/mail-flows.sh (qui vérifie le pré-requis) : ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
