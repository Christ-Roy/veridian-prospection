import { NextRequest, NextResponse } from "next/server";
import { requireUser, getWorkspaceScope } from "@/lib/auth/user-context";
import { getProspectTimeline, type TimelineEvent } from "@/lib/queries/timeline";

/**
 * GET /api/leads/[siren]/timeline
 *
 * Fiche historique prospect 360° — Phase 1 (ticket 2026-05-23).
 * Renvoie le fil chronologique agrégé d'un prospect : pipeline_transitions
 * + followups + appointments triés par occurred_at desc.
 *
 * Query params optionnels :
 *  - `types=pipeline_transition,followup` : filtre par type (CSV).
 *  - `since=ISO` / `until=ISO` : filtre fenêtre temporelle.
 *  - `limit=N` : limite globale (1-500, défaut 200).
 *
 * Auth : requireUser() — un user qui tape ce siren sans avoir accès au
 * workspace propriétaire reçoit 200 + [] (filtre Prisma sur tenant +
 * workspaceFilter). Pas de 403 spécifique : ne pas révéler l'existence du
 * prospect côté inter-tenant.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { domain: siren } = await params;

  if (!/^\d{9}$/.test(siren)) {
    return NextResponse.json({ error: "Invalid SIREN" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const typesParam = searchParams.get("types");
  // Whitelist stricte des types autorisés. Si le param
  // est absent → `undefined` côté query (= tous types). Si l'appelant l'a
  // explicitement fourni → on filtre par whitelist, retourne `[]` au pire
  // (la query interprète ça comme "rien", pas "tout").
  // Phase 1 : pipeline_transition + followup + appointment.
  // Phase 2 : mail_out (mails entrants = mail_in, livré par W8b plus tard).
  // Phase 3 : call (call_log Telnyx in/out).
  const ALLOWED_TYPES: ReadonlyArray<TimelineEvent["type"]> = [
    "pipeline_transition",
    "followup",
    "appointment",
    "mail_out",
    "call",
  ];
  const types =
    typesParam === null
      ? undefined
      : typesParam
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is TimelineEvent["type"] =>
            (ALLOWED_TYPES as ReadonlyArray<string>).includes(s),
          );
  const since = searchParams.get("since");
  const until = searchParams.get("until");
  const limitParam = searchParams.get("limit");
  const limit = limitParam
    ? Math.min(Math.max(parseInt(limitParam, 10) || 200, 1), 500)
    : 200;

  const { filter: workspaceFilter } = await getWorkspaceScope();

  const events = await getProspectTimeline({
    siren,
    tenantId: ctx.tenantId,
    workspaceFilter,
    types,
    since: since || null,
    until: until || null,
    limit,
  });

  return NextResponse.json(
    { events },
    { headers: { "Cache-Control": "private, max-age=10" } },
  );
}
