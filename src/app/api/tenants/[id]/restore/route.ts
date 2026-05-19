/**
 * POST /api/tenants/{id}/restore — contrat §5.8.2
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Comportement (§5.7 transition légale) :
 *  - Annule soft_delete : deletedAt = NULL, purgeEligibleAt = NULL.
 *  - **Passe en `suspended`** (PAS `active`) — l'admin doit ensuite resume
 *    manuellement (cf §5.7 règle #3).
 *  - Idempotent : si pas soft_deleted, retourne 409 tenant_not_soft_deleted.
 *  - Refuse 409 si tenant purged (irréversible).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireHubHmac } from "@/lib/hub/auth";
import { prisma } from "@/lib/prisma";

type RestoreBody = {
  tenant_id?: string;
  reason?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireHubHmac<RestoreBody>(request);
  if (!auth.ok) return auth.response;

  const { id: tenantId } = await params;
  if (!tenantId) {
    return NextResponse.json(
      { error: "invalid_payload", message: "tenant id is required" },
      { status: 400 },
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      deletedAt: true,
      purgedAt: true,
      metadata: true,
    },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  if (tenant.purgedAt) {
    return NextResponse.json(
      { error: "transition_illegal", message: "tenant already purged" },
      { status: 409 },
    );
  }

  if (!tenant.deletedAt) {
    return NextResponse.json(
      { error: "tenant_not_soft_deleted" },
      { status: 409 },
    );
  }

  const now = new Date();
  const { reason } = auth.body;
  const meta = (tenant.metadata as Record<string, unknown> | null) ?? {};

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      deletedAt: null,
      purgeEligibleAt: null,
      // §5.7 règle #3 : restore → suspended (pas active).
      status: "suspended",
      metadata: {
        ...meta,
        restoredAt: now.toISOString(),
        restoreReason: reason ?? null,
      },
    },
  });

  console.log(`[restore] tenant=${tenantId} → suspended`);

  return NextResponse.json({
    tenant_id: tenantId,
    restored_at: now.toISOString(),
    new_status: "suspended",
  });
}
