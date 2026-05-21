/**
 * POST /api/tenants/{id}/purge — contrat §5.8.3
 *
 * ⚠️ HARD DELETE — IRRÉVERSIBLE.
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Garde-fous critiques (TOUS DOIVENT PASSER pour exécuter) :
 *  1. tenant.deletedAt != null (déjà soft-deleted)
 *  2. tenant.purgeEligibleAt != null && tenant.purgeEligibleAt <= NOW
 *  3. tenant.purgedAt == null (pas déjà purgé)
 *  4. body.confirm_slug == tenant.slug (anti-erreur opérateur)
 *  5. body.reason présent (audit GDPR)
 *
 * Cascade DELETE explicite par table tenant_id-scoped. On garde la ligne
 * tenant elle-même avec status='purged' + purged_at=NOW + PII NULL pour
 * audit GDPR (cf §5.8.3 "preuve que la suppression a eu lieu").
 *
 * Émet webhook tenant.purged en fire-and-forget.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireHubHmac } from "@/lib/hub/auth";
import { emitHubWebhookAsync } from "@/lib/hub/webhooks";
import { prisma } from "@/lib/prisma";
import { resolveTenantByIdOrEmail } from "@/lib/hub/tenant-lookup";

type PurgeBody = {
  tenant_id?: string;
  confirm_slug?: string;
  reason?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireHubHmac<PurgeBody>(request);
  if (!auth.ok) return auth.response;

  const { id: tenantIdParam } = await params;
  if (!tenantIdParam) {
    return NextResponse.json(
      { error: "invalid_payload", message: "tenant id is required" },
      { status: 400 },
    );
  }

  const { confirm_slug, reason } = auth.body;

  if (!confirm_slug) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "confirm_slug is required (must match tenant.slug)",
      },
      { status: 400 },
    );
  }
  if (!reason || reason.trim().length < 3) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "reason is required (audit GDPR, >= 3 chars)",
      },
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
    select: {
      id: true,
      slug: true,
      deletedAt: true,
      purgeEligibleAt: true,
      purgedAt: true,
    },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  // Garde-fou 1 — déjà purgé
  if (tenant.purgedAt) {
    return NextResponse.json(
      { error: "transition_illegal", message: "tenant already purged" },
      { status: 409 },
    );
  }

  // Garde-fou 2 — slug ne matche pas
  if (confirm_slug !== tenant.slug) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "confirm_slug does not match tenant slug",
      },
      { status: 400 },
    );
  }

  // Garde-fou 3 — pas soft_deleted
  if (!tenant.deletedAt) {
    return NextResponse.json(
      {
        error: "tenant_not_purge_eligible",
        message: "tenant must be soft_deleted first",
      },
      { status: 409 },
    );
  }

  // Garde-fou 4 — purge_eligible_at dans le futur
  const now = new Date();
  if (!tenant.purgeEligibleAt || tenant.purgeEligibleAt > now) {
    return NextResponse.json(
      {
        error: "tenant_not_purge_eligible",
        message: "purge_eligible_at is in the future",
        details: {
          purge_eligible_at: tenant.purgeEligibleAt?.toISOString() ?? null,
        },
      },
      { status: 409 },
    );
  }

  // Cascade DELETE explicite (transaction atomique).
  // L'ordre suit la dépendance : enfants d'abord, puis workspaces, puis tenant.
  const rowsDeleted = await prisma.$transaction(async (tx) => {
    const rows: Record<string, number> = {};

    // Tables tenant_id-scoped (data métier)
    const r1 = await tx.outreach.deleteMany({ where: { tenantId } });
    rows.outreach = r1.count;

    const r3 = await tx.callLog.deleteMany({ where: { tenantId } });
    rows.call_log = r3.count;

    const r4 = await tx.claudeActivity.deleteMany({ where: { tenantId } });
    rows.claude_activity = r4.count;

    const r5 = await tx.followup.deleteMany({ where: { tenantId } });
    rows.followups = r5.count;

    const r6 = await tx.appointment.deleteMany({ where: { tenantId } });
    rows.appointments = r6.count;

    // Plan history — audit du tenant lui-même, on vire en cascade
    const r7 = await tx.planHistory.deleteMany({ where: { tenantId } });
    rows.plan_history = r7.count;

    // Workspaces (cascade automatique sur workspace_members via FK)
    const r8 = await tx.workspace.deleteMany({ where: { tenantId } });
    rows.workspaces = r8.count;

    // Marquer le tenant comme purged (audit GDPR : on garde la ligne mais
    // sans PII identifiantes). status='deleted' qui existe dans l'enum.
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        status: "deleted",
        purgedAt: now,
        // PII null
        name: "[purged]",
        // Slug doit rester unique → on suffixe avec purged_at pour éviter
        // collision si un nouveau tenant arrive avec le même slug.
        slug: `${tenant.slug}-purged-${now.getTime()}`,
        // Intégrations tierces nulled
        twentyApiKey: null,
        twentyUserEmail: null,
        twentyUserPassword: null,
        twentyLoginToken: null,
        notifuseApiKey: null,
        notifuseUserEmail: null,
        notifuseWorkspaceSlug: null,
        // Plan info reset
        plan: null,
        planSource: null,
        // metadata nulled mais on garde une trace de la raison
        metadata: {
          purgedAt: now.toISOString(),
          purgeReason: reason,
        },
      },
    });

    return rows;
  });

  console.log(
    `[purge] tenant=${tenantId} slug=${tenant.slug} rows=${JSON.stringify(rowsDeleted)} reason="${reason}"`,
  );

  emitHubWebhookAsync("tenant.deleted", tenantId, {
    event_subtype: "purged",
    purged_at: now.toISOString(),
    rows_deleted: rowsDeleted,
    reason,
  });

  return NextResponse.json({
    tenant_id: tenantId,
    purged_at: now.toISOString(),
    rows_deleted: rowsDeleted,
  });
}
