import { NextRequest, NextResponse } from "next/server";
import { getLeadDetail, recordVisit, patchOutreach, consumeLead } from "@/lib/queries";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId, getTenantProspectLimit } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import { isUserFrozen } from "@/lib/auth/freeze";
import { isKnownStatus } from "@/lib/outreach/status";

// Anti-scraping: max 30 lead detail views per minute per user
const LEADS_RATE_LIMIT = 30;
const LEADS_WINDOW_MS = 60_000;

// Sensitive fields to truncate for freemium users
const SENSITIVE_FIELDS = ["email", "dirigeant_email", "phone", "dirigeant", "qualite_dirigeant", "emails", "phones", "email_principal", "phone_principal"];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const userId = auth.user.id;

  // Rate limiting: 30 fiches/min per user
  if (isRateLimited(`leads:${userId}`, LEADS_RATE_LIMIT, LEADS_WINDOW_MS)) {
    return NextResponse.json(
      { error: "Trop de requetes. Reessayez dans quelques instants." },
      { status: 429, headers: { "Retry-After": "30" } }
    );
  }

  const tenantId = await getTenantId(userId);
  const { insertId: workspaceId } = await getWorkspaceScope();
  // URL param named `domain` for back-compat but now carries a SIREN (9 digits)
  const { domain: siren } = await params;
  const lead = await getLeadDetail(siren, tenantId);
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
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

  return NextResponse.json(lead, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}

/**
 * PATCH /api/leads/[domain] — mise à jour partielle d'un lead.
 *
 * Verbe appelé par le front pour le changement de statut prospect
 * (sélection groupée, bouton « + Pipeline » table + carte mobile,
 * cf prospect-page.tsx). Avant ce handler, l'endpoint ne répondait
 * qu'en GET → tous ces appels partaient en 405 silencieux.
 *
 * Body attendu : `{ status }` — `status` doit être une valeur métier
 * connue (cf STATUS_TO_PIPELINE). L'écriture est scopée au tenant courant
 * via `patchOutreach`, qui synchronise aussi `pipeline_stage`.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const userId = auth.user.id;
  const tenantId = await getTenantId(userId);
  const { insertId: workspaceId } = await getWorkspaceScope();
  // URL param named `domain` for back-compat but now carries a SIREN.
  const { domain: siren } = await params;

  // Pattern Veridian : .catch fallback objet vide → pas de 500 sur JSON
  // malformé, la validation explicite ci-dessous rejette proprement.
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // `status` est obligatoire et doit être une valeur métier connue : un
  // status libre atterrirait en DB et désyncerait le funnel.
  if (!isKnownStatus(body.status)) {
    return NextResponse.json(
      { error: "Champ 'status' invalide ou manquant." },
      { status: 400 }
    );
  }

  // Update scopé au tenant courant (multi-tenant) : patchOutreach filtre
  // toujours sur tenant_id, impossible de toucher un lead d'un autre tenant.
  await patchOutreach(siren, { status: body.status }, tenantId, workspaceId, userId);

  return NextResponse.json({ ok: true });
}
