/**
 * Signature commerciale auto (ticket follow-ups §J, W9c).
 *
 * Append la signature HTML + plain text au payload mail si configurée
 * et activée pour le tenant. Lue depuis `tenant_mail_config`
 * (migration 0030).
 *
 * Appelée par /api/mail/send (synchrone direct) AVANT l'appel SMTP /
 * Hub Gateway. Découplée d'`outbox.ts` (la queue async a été supprimée
 * 2026-05-26 — sur-ingénierie pour notre cas 1 mail manuel à la fois,
 * cf revert post-W9c).
 *
 * No-op si :
 *  - pas de row tenant_mail_config
 *  - mailSignatureEnabled = false
 *  - mailSignatureHtml NULL ou vide
 */
import type { PrismaClient } from "@prisma/client";

export interface MailBody {
  bodyText: string;
  bodyHtml: string;
}

export async function applySignatureIfEnabled<T extends MailBody>(
  client: PrismaClient,
  tenantId: string,
  body: T,
): Promise<T> {
  const cfg = await client.tenantMailConfig.findUnique({
    where: { tenantId },
    select: {
      mailSignatureHtml: true,
      mailSignatureEnabled: true,
    },
  });
  if (!cfg || !cfg.mailSignatureEnabled) return body;
  const sig = (cfg.mailSignatureHtml ?? "").trim();
  if (!sig) return body;

  // bodyHtml : append séparateur + signature HTML (div wrapper pour
  // permettre du styling client si besoin).
  // bodyText : append signature en plain text (strip HTML basique).
  const signatureText = stripHtml(sig);
  return {
    ...body,
    bodyHtml: `${body.bodyHtml}<br><br><div class="veridian-mail-signature">${sig}</div>`,
    bodyText: `${body.bodyText}\n\n--\n${signatureText}`,
  };
}

/** Strip HTML tags pour le fallback text — naïf mais suffisant pour signature. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
