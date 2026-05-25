/**
 * Orchestrateur du cron IMAP : pour chaque tenant avec config IMAP active,
 * fetch les nouveaux messages depuis le dernier UID vu, parse, match au
 * prospect (best_email) et insère dans lead_emails.
 *
 * Garanties :
 *  - Per-tenant : un tenant qui échoue (auth_failed, host down…) ne bloque
 *    pas les autres. Le run continue.
 *  - Idempotent : message_id UNIQUE + recordIncomingEmail swallow le P2002.
 *  - High-water mark : on persiste lastUidSeen seulement après insertion
 *    réussie (ou tenté) — un crash entre fetch et persist refera le run
 *    sans perte (re-fetch + INSERT dédupliqué = OK).
 *  - Status logging : chaque tenant alimente imap_last_sync_at/status/error.
 */
import { fetchNewMessages, type ImapReason } from "@/lib/mail/imap-client";
import { matchProspectByEmail } from "@/lib/mail/match-prospect";
import {
  listImapEnabledTenants,
  recordImapSyncResult,
  recordIncomingEmail,
} from "@/lib/mail/queries";

export interface PerTenantResult {
  tenantId: string;
  ok: boolean;
  reason?: ImapReason;
  fetched: number;
  inserted: number;
  duplicates: number;
  /** Mails dont l'insert a throw (DB down…) — distingué des duplicates pour
   *  remonter une vraie erreur côté monitoring. */
  errors: number;
  matched: number;
  unmatched: number;
  errorMessage?: string;
}

export interface SyncResult {
  totalTenants: number;
  okTenants: number;
  failedTenants: number;
  totalInserted: number;
  perTenant: PerTenantResult[];
}

/** Sync 1 tenant. Best-effort — ne throw jamais. */
export async function syncOneTenant(creds: {
  tenantId: string;
  host: string;
  port: number;
  username: string;
  passwordEnc: string;
  tls: boolean;
  folder: string;
  lastUidSeen: number | null;
}): Promise<PerTenantResult> {
  const res = await fetchNewMessages(
    {
      host: creds.host,
      port: creds.port,
      username: creds.username,
      passwordEnc: creds.passwordEnc,
      tls: creds.tls,
      folder: creds.folder,
    },
    creds.lastUidSeen,
  );

  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  let matched = 0;
  let unmatched = 0;

  if (res.messages.length > 0) {
    for (const msg of res.messages) {
      const siren = await matchProspectByEmail(creds.tenantId, msg.fromEmail);
      if (siren) matched++;
      else unmatched++;

      // 3 issues possibles : true=inserté, false=duplicate dédupliqué,
      // null=erreur DB swallowée. On les distingue dans le compteur pour
      // que le monitoring voie les vraies erreurs (vs déduplications normales).
      let outcome: true | false | null;
      try {
        outcome = await recordIncomingEmail({
          tenantId: creds.tenantId,
          siren,
          messageId: msg.messageId,
          inReplyTo: msg.inReplyTo,
          references: msg.references,
          fromEmail: msg.fromEmail ?? "(unknown)",
          fromName: msg.fromName,
          toEmails: msg.toEmails,
          ccEmails: msg.ccEmails,
          subject: msg.subject,
          bodyText: msg.bodyText && msg.bodyText.length > 0 ? msg.bodyText : "(no body)",
          bodyHtml: msg.bodyHtml,
          receivedAt: msg.receivedAt,
        });
      } catch (err) {
        console.error(
          `[imap-sync] insert failed tenant=${creds.tenantId} uid=${msg.uid}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        outcome = null;
      }
      if (outcome === true) inserted++;
      else if (outcome === false) duplicates++;
      else errors++;
    }
  }

  // Persist status (toujours, qu'on ait des mails ou pas).
  try {
    await recordImapSyncResult(creds.tenantId, {
      status: res.ok ? "ok" : res.reason ?? "unknown",
      error: res.ok ? null : res.errorMessage ?? null,
      lastUidSeen: res.lastUid,
    });
  } catch (err) {
    console.error(
      `[imap-sync] recordImapSyncResult failed tenant=${creds.tenantId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return {
    tenantId: creds.tenantId,
    ok: res.ok,
    reason: res.reason,
    fetched: res.messages.length,
    inserted,
    duplicates,
    errors,
    matched,
    unmatched,
    errorMessage: res.errorMessage,
  };
}

/** Sync séquentiel de tous les tenants IMAP-enabled. */
export async function runImapSync(): Promise<SyncResult> {
  const tenants = await listImapEnabledTenants();
  const perTenant: PerTenantResult[] = [];

  // Séquentiel volontaire : chaque IMAP open ouvre une socket TCP + une
  // session DB ; en parallèle on saturerait vite la machine pour 5 min de
  // latence acceptable. Si on passe > 20 tenants IMAP-enabled, switch à
  // un pool concurrent (genre p-limit(5)).
  for (const t of tenants) {
    try {
      const r = await syncOneTenant(t);
      perTenant.push(r);
    } catch (err) {
      // Filet de sécurité — syncOneTenant ne devrait jamais throw, mais
      // si une mauvaise surprise survient, on logge et on continue.
      console.error(
        `[imap-sync] FATAL syncOneTenant tenant=${t.tenantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      perTenant.push({
        tenantId: t.tenantId,
        ok: false,
        reason: "unknown",
        fetched: 0,
        inserted: 0,
        duplicates: 0,
        errors: 0,
        matched: 0,
        unmatched: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const okTenants = perTenant.filter((r) => r.ok).length;
  return {
    totalTenants: perTenant.length,
    okTenants,
    failedTenants: perTenant.length - okTenants,
    totalInserted: perTenant.reduce((sum, r) => sum + r.inserted, 0),
    perTenant,
  };
}
