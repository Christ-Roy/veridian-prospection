/**
 * Consultation d'une fiche entreprise, commune à l'écran (`GET /api/leads/[siren]`) et au MCP :
 * même anti-aspiration (30 fiches/min/utilisateur, compteur partagé), même décompte du quota,
 * même masquage des champs sensibles. Une IA ne lit jamais plus que l'utilisateur à l'écran.
 */
import { getLeadDetail, recordVisit, consumeLead } from "@/lib/queries";
import { getTenantProspectLimit } from "@/lib/auth/tenant";
import { isRateLimited } from "@/lib/rate-limit";
import { isUserFrozen } from "@/lib/auth/freeze";
import type { LeadDetail } from "@/lib/types";

const LEADS_RATE_LIMIT = 30;
const LEADS_WINDOW_MS = 60_000;

// Champs sensibles tronqués pour un essai expiré ou un utilisateur gelé.
const SENSITIVE_FIELDS = ["email", "dirigeant_email", "phone", "dirigeant", "qualite_dirigeant", "emails", "phones", "email_principal", "phone_principal"];

export type LeadDetailOutcome =
  | { kind: "rate_limited" }
  | { kind: "not_found" }
  | { kind: "ok"; lead: LeadDetail };

/** `scope` n'est résolu qu'après le contrôle de débit : un appel refusé ne touche pas la base. */
export async function serveLeadDetail(p: {
  userId: string;
  siren: string;
  scope: () => Promise<{ tenantId: string | null; workspaceId: string | null }>;
}): Promise<LeadDetailOutcome> {
  const { userId, siren } = p;

  if (isRateLimited(`leads:${userId}`, LEADS_RATE_LIMIT, LEADS_WINDOW_MS)) {
    return { kind: "rate_limited" };
  }
  const { tenantId, workspaceId } = await p.scope();

  const lead = await getLeadDetail(siren, tenantId);
  if (!lead) return { kind: "not_found" };
  await recordVisit(siren, tenantId, workspaceId, userId);
  lead.last_visited = new Date().toISOString().replace("T", " ").split(".")[0];

  // Décompte du quota refill : consulter une fiche consomme 1 lead, idempotent
  // par (workspace, siren). Fail-safe — un échec du décompte ne doit JAMAIS
  // bloquer la consultation (doctrine pricing : pas de mur béton). On consomme
  // après que la fiche soit confirmée servie.
  consumeLead(siren, tenantId, workspaceId).catch((err) => {
    console.error(`[leads] consumeLead failed siren=${siren}:`, err);
  });

  // Obfuscation des champs sensibles : 2 déclencheurs cumulatifs.
  //  1) Freemium expiré (logique trial historique)
  //  2) Freeze cross-app Hub §5.21 — l'admin Veridian a frozen ce user
  //     indépendamment du plan (impayé seat, suspension membre, etc.)
  const prospectLimit = await getTenantProspectLimit(userId);
  const isPaidPlan = prospectLimit > 300;
  let obfuscate = false;
  if (!isPaidPlan) {
    const { checkTrialExpired } = await import("@/lib/trial");
    obfuscate = await checkTrialExpired(userId);
  }
  if (!obfuscate && tenantId) {
    obfuscate = await isUserFrozen(userId, tenantId);
  }
  if (obfuscate) {
    const record = lead as unknown as Record<string, unknown>;
    for (const field of SENSITIVE_FIELDS) {
      const val = record[field];
      if (typeof val === "string" && val.length > 0) {
        // Don't break JSON arrays — replace with valid placeholder
        if (val.startsWith("[")) {
          record[field] = "[]";
        } else {
          const cutoff = Math.max(1, Math.floor(val.length * 0.33));
          record[field] = val.slice(0, cutoff) + "•".repeat(val.length - cutoff);
        }
      }
    }
  }

  return { kind: "ok", lead };
}
