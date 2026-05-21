/**
 * GET /api/tenants/{id}/usage-summary — contrat §5.8.5
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Fournit au Hub un résumé d'usage agrégé d'un tenant Prospection pour
 * **décision humaine éclairée** avant purge. Pas de cache : la valeur
 * change rarement, mais on veut la valeur live au moment de la décision.
 *
 * Format de réponse standardisé contrat §5.8.5 + champ domain_specific
 * propre à Prospection (prospects_seen, outreach_sent, appointments).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireHubHmac } from "@/lib/hub/auth";
import { prisma } from "@/lib/prisma";
import { resolveTenantByIdOrEmail } from "@/lib/hub/tenant-lookup";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireHubHmac<unknown>(request);
  if (!auth.ok) return auth.response;

  const { id: tenantIdParam } = await params;
  if (!tenantIdParam) {
    return NextResponse.json(
      { error: "invalid_payload", message: "tenant id is required" },
      { status: 400 },
    );
  }

  // Le Hub peut envoyer soit l'UUID local soit l'email owner (provision legacy).
  // Cf todo/2026-05-21-tenant-id-accept-email-or-uuid.md.
  const resolved = await resolveTenantByIdOrEmail(tenantIdParam);
  if (!resolved) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  const tenantId = resolved.id;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, lastActivityAt: true, lastTouchedAt: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  // Agrégats par table tenant_id-scoped
  const [
    outreachCount,
    callLogCount,
    appointmentsCount,
    followupsCount,
    workspaceCount,
    activeMembersCount,
  ] = await Promise.all([
    prisma.outreach.count({ where: { tenantId } }),
    prisma.callLog.count({ where: { tenantId } }),
    prisma.appointment.count({ where: { tenantId } }),
    prisma.followup.count({ where: { tenantId } }),
    prisma.workspace.count({ where: { tenantId, deletedAt: null } }),
    prisma.workspaceMember.count({
      where: { workspace: { tenantId }, deletedAt: null },
    }),
  ]);

  const rowsTotal =
    outreachCount +
    callLogCount +
    appointmentsCount +
    followupsCount;

  // Estimation taille DB : moyenne grossière 0.5 KB/row (data métier
  // Prospection). C'est délibérément approximatif — pour précision
  // demander à Robert d'ajouter un pg_table_size() raw query si besoin
  // un jour. Le Hub admin panel a juste besoin d'un ordre de grandeur.
  const sizeMbEstimate = Math.round((rowsTotal * 0.5) / 1024);

  // Activité user récente. lastTouchedAt n'est rempli que sur les
  // tenants soft_deleted (via webhook tenant.touched §5.8.4). Pour les
  // tenants actifs, lastActivityAt est la source.
  const lastUserActivityAt =
    tenant.lastTouchedAt ?? tenant.lastActivityAt ?? null;

  // Active users 30d — proxy via appointments récents (la seule table
  // tenant-scoped avec un timestamp DateTime propre côté schema actuel).
  // Si appointment dans les 30j → on retourne le nombre de membres
  // workspace actifs. Sinon 0. Pour multi-user fine-grained on aura
  // besoin d'une colonne `last_active_at` par WorkspaceMember (TODO).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentAppointments = await prisma.appointment.count({
    where: { tenantId, startAt: { gte: thirtyDaysAgo } },
  });
  const activeUsers30d = recentAppointments > 0 ? activeMembersCount : 0;

  return NextResponse.json({
    tenant_id: tenantId,
    workspace_id: null, // multi-workspace par tenant, on retourne pas un seul
    data_volume: {
      rows_total: rowsTotal,
      size_mb_estimate: sizeMbEstimate,
    },
    activity: {
      last_user_activity_at: lastUserActivityAt?.toISOString() ?? null,
      last_machine_activity_at: null,
      active_users_30d: activeUsers30d,
    },
    domain_specific: {
      prospects_outreach_total: outreachCount,
      calls_logged_total: callLogCount,
      appointments_total: appointmentsCount,
      followups_total: followupsCount,
      workspaces_count: workspaceCount,
      active_members_count: activeMembersCount,
    },
    checked_at: new Date().toISOString(),
  });
}
