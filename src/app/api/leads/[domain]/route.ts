import { NextRequest, NextResponse } from "next/server";
import { patchOutreach } from "@/lib/queries";
import { requireAuth } from "@/lib/auth/api-auth";
import { getTenantId } from "@/lib/auth/tenant";
import { getWorkspaceScope } from "@/lib/auth/user-context";
import { serveLeadDetail } from "@/lib/leads/serve-detail";
import { isKnownStatus } from "@/lib/outreach/status";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const userId = auth.user.id;
  // URL param named `domain` for back-compat but now carries a SIREN (9 digits)
  const { domain: siren } = await params;

  // Quota, anti-aspiration et masquage : partagés avec le MCP (src/lib/leads/serve-detail.ts).
  const outcome = await serveLeadDetail({
    userId,
    siren,
    scope: async () => ({
      tenantId: await getTenantId(userId),
      workspaceId: (await getWorkspaceScope()).insertId,
    }),
  });
  if (outcome.kind === "rate_limited") {
    return NextResponse.json(
      { error: "Trop de requetes. Reessayez dans quelques instants." },
      { status: 429, headers: { "Retry-After": "30" } }
    );
  }
  if (outcome.kind === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(outcome.lead, {
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
