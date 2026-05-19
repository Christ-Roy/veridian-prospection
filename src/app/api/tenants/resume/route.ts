/**
 * POST /api/tenants/resume — contrat §5.4
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Comportement : marque tenant.status = "active". Idempotent : si déjà actif,
 * retourne 200 avec resumed_at courant. Si le tenant est soft-deleted, on
 * refuse (transition illégale §5.7 — il faut d'abord `restore`).
 *
 * Émet un webhook tenant.resumed (P5).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireHubHmac } from "@/lib/hub/auth";
import { emitHubWebhookAsync } from "@/lib/hub/webhooks";
import { prisma } from "@/lib/prisma";

type ResumeBody = { tenant_id?: string };

export async function POST(request: NextRequest) {
  const auth = await requireHubHmac<ResumeBody>(request);
  if (!auth.ok) return auth.response;

  const { tenant_id } = auth.body;
  if (!tenant_id) {
    return NextResponse.json(
      { error: "invalid_payload", message: "tenant_id is required" },
      { status: 400 },
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenant_id },
    select: { id: true, status: true, deletedAt: true, metadata: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  if (tenant.deletedAt) {
    return NextResponse.json(
      {
        error: "transition_illegal",
        message: "tenant is soft_deleted — call /restore first",
      },
      { status: 409 },
    );
  }

  const now = new Date();
  if (tenant.status !== "active") {
    const meta = (tenant.metadata as Record<string, unknown> | null) ?? {};
    await prisma.tenant.update({
      where: { id: tenant_id },
      data: {
        status: "active",
        metadata: { ...meta, resumedAt: now.toISOString() },
      },
    });
    console.log(`[resume] tenant=${tenant_id}`);

    emitHubWebhookAsync("tenant.resumed", tenant_id, {
      resumed_at: now.toISOString(),
    });
  }

  return NextResponse.json({
    tenant_id,
    resumed_at: now.toISOString(),
  });
}
