/**
 * POST /api/tenants/{id}/soft-delete — contrat §5.8.1
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Comportement :
 *  - Marque deletedAt = NOW() et purgeEligibleAt = body.purge_eligible_at
 *    (calculé Hub via SOFT_DELETE_GRACE_DAYS, ~90j default).
 *  - NE SUPPRIME PAS la data. Mode paywall obfusqué activé (§5.9).
 *  - Idempotent : si déjà soft_deleted, retourne 200 no-op avec les
 *    valeurs courantes.
 *  - Émet webhook tenant.deleted en fire-and-forget.
 *  - Transition légale §5.7 : `active` ou `suspended` → `soft_deleted`.
 *    Toute autre transition retourne 409 transition_illegal.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireHubHmac } from "@/lib/hub/auth";
import { emitHubWebhookAsync } from "@/lib/hub/webhooks";
import { prisma } from "@/lib/prisma";
import { resolveTenantByIdOrEmail } from "@/lib/hub/tenant-lookup";

type SoftDeleteBody = {
  tenant_id?: string;
  reason?:
    | "admin_action"
    | "stripe_canceled"
    | "trial_expired"
    | "abuse"
    | "user_request";
  purge_eligible_at?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireHubHmac<SoftDeleteBody>(request);
  if (!auth.ok) return auth.response;

  const { id: tenantIdParam } = await params;
  if (!tenantIdParam) {
    return NextResponse.json(
      { error: "invalid_payload", message: "tenant id is required" },
      { status: 400 },
    );
  }

  const { reason = "admin_action", purge_eligible_at } = auth.body;

  if (!purge_eligible_at) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "purge_eligible_at is required (ISO8601, calculé Hub)",
      },
      { status: 400 },
    );
  }
  const purgeEligibleDate = new Date(purge_eligible_at);
  if (Number.isNaN(purgeEligibleDate.getTime())) {
    return NextResponse.json(
      { error: "invalid_payload", message: "purge_eligible_at malformé" },
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
      status: true,
      deletedAt: true,
      purgeEligibleAt: true,
      purgedAt: true,
      metadata: true,
    },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  // §5.7 — transition légale uniquement depuis active/suspended.
  // Une fois purged, plus aucun retour possible.
  if (tenant.purgedAt) {
    return NextResponse.json(
      {
        error: "transition_illegal",
        message: "tenant already purged",
      },
      { status: 409 },
    );
  }

  // Idempotent : déjà soft_deleted → no-op, retour valeurs existantes.
  if (tenant.deletedAt) {
    return NextResponse.json({
      tenant_id: tenantId,
      soft_deleted_at: tenant.deletedAt.toISOString(),
      purge_eligible_at: tenant.purgeEligibleAt?.toISOString() ?? purge_eligible_at,
      previous_status: tenant.status === "suspended" ? "suspended" : "active",
    });
  }

  const previousStatus: "active" | "suspended" =
    tenant.status === "suspended" ? "suspended" : "active";
  const meta = (tenant.metadata as Record<string, unknown> | null) ?? {};
  const now = new Date();

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      deletedAt: now,
      purgeEligibleAt: purgeEligibleDate,
      // status reste tel quel (active/suspended) — la machine d'état lit deletedAt
      // pour déterminer "soft_deleted" dans /health (§5.5).
      metadata: {
        ...meta,
        softDeleteReason: reason,
      },
    },
  });

  console.log(
    `[soft-delete] tenant=${tenantId} reason=${reason} purge_eligible_at=${purgeEligibleDate.toISOString()}`,
  );

  emitHubWebhookAsync("tenant.deleted", tenantId, {
    soft_deleted_at: now.toISOString(),
    purge_eligible_at: purgeEligibleDate.toISOString(),
    reason,
  });

  return NextResponse.json({
    tenant_id: tenantId,
    soft_deleted_at: now.toISOString(),
    purge_eligible_at: purgeEligibleDate.toISOString(),
    previous_status: previousStatus,
  });
}
