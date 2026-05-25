/**
 * Match d'un mail entrant IMAP → SIREN prospect.
 *
 * Stratégie v2 (cron W8b 2026-05-25) : on cherche l'expéditeur dans
 * `entreprises.best_email_normalized` (ou `best_email`). Si match unique →
 * on rattache. Si match multiple (ex: même mail générique pour 2 entreprises) →
 * on prend le 1er mais on logge. Si aucun match → siren=NULL (mail entrant
 * stocké pour /inbox global, pas relié à une fiche 360°).
 *
 * Le match est case-insensitive et trim. On reste dans le scope du tenant
 * appelant — on ne fuite jamais un siren d'un autre tenant.
 *
 * Pourquoi pas une table dédiée d'alias mail ↔ siren : v2 keep it simple,
 * 99% des cas le mail entrant vient de l'adresse qu'on a envoyé via SMTP
 * (mail.bestEmail de la fiche). Si v3 a besoin d'aliases multiples, on
 * ajoutera une table prospect_email_aliases.
 */
import { prisma } from "@/lib/prisma";

/**
 * Retourne le siren de l'entreprise du tenant dont best_email match `email`.
 * null si pas de match.
 */
export async function matchProspectByEmail(
  tenantId: string,
  fromEmail: string | null,
): Promise<string | null> {
  if (!fromEmail) return null;
  const normalized = fromEmail.trim().toLowerCase();
  if (normalized.length === 0) return null;

  // On cherche d'abord dans la colonne `best_email_normalized` (déjà
  // lowercase) puis fallback `best_email`. Limit 2 pour détecter les
  // collisions silencieusement (pris 1er + log warn).
  const rows = await prisma.$queryRaw<Array<{ siren: string }>>`
    SELECT siren
    FROM entreprises
    WHERE (best_email_normalized = ${normalized} OR LOWER(best_email) = ${normalized})
      AND siren IN (
        SELECT siren FROM outreach WHERE tenant_id = ${tenantId}::uuid
      )
    LIMIT 2
  `;

  if (rows.length === 0) return null;
  if (rows.length > 1) {
    console.warn(
      `[match-prospect] multiple sirens match email=${normalized} tenant=${tenantId} → picking first (${rows[0].siren})`,
    );
  }
  return rows[0].siren;
}
