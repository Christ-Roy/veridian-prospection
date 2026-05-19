/**
 * POST /api/tenants/suspend — contrat §5.4
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Comportement : marque tenant.status = "suspended" et stocke metadata
 * `lastSuspendReason` + `suspendedAt`. La data tenant reste intacte ; toutes
 * les écritures user côté app doivent être bloquées en 402 (middleware
 * runtime — à câbler progressivement, suspended_at est l'invariant DB).
 *
 * Idempotent : si déjà suspendu, retourne 200 avec les valeurs courantes.
 *
 * Émet un webhook tenant.suspended côté Hub (P5, non implémenté ici).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireHubHmac } from "@/lib/hub/auth";
import { emitHubWebhookAsync } from "@/lib/hub/webhooks";
import { prisma } from "@/lib/prisma";

type SuspendBody = {
  tenant_id?: string;
  reason?: "billing_past_due" | "admin_action" | "quota_exceeded";
};

export async function POST(request: NextRequest) {
  const auth = await requireHubHmac<SuspendBody>(request);
  if (!auth.ok) return auth.response;

  const { tenant_id, reason } = auth.body;
  if (!tenant_id) {
    return NextResponse.json(
      { error: "invalid_payload", message: "tenant_id is required" },
      { status: 400 },
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenant_id },
    select: { id: true, status: true, metadata: true },
  });
  if (!tenant) {
    return NextResponse.json(
      { error: "tenant_not_found" },
      { status: 404 },
    );
  }

  const now = new Date();
  const meta = (tenant.metadata as Record<string, unknown> | null) ?? {};
  const suspendedAt =
    tenant.status === "suspended"
      ? ((meta.suspendedAt as string | undefined) ?? now.toISOString())
      : now.toISOString();

  if (tenant.status !== "suspended") {
    await prisma.tenant.update({
      where: { id: tenant_id },
      data: {
        status: "suspended",
        metadata: {
          ...meta,
          suspendedAt,
          lastSuspendReason: reason ?? "admin_action",
        },
      },
    });
    console.log(`[suspend] tenant=${tenant_id} reason=${reason ?? "admin_action"}`);

    // Fire-and-forget webhook Hub. Le contrat §7.1 prévoit cet event pour
    // que le Hub puisse propager l'état dans son admin lifecycle panel.
    emitHubWebhookAsync("tenant.suspended", tenant_id, {
      suspended_at: suspendedAt,
      reason: reason ?? "admin_action",
    });
  }

  return NextResponse.json({
    tenant_id,
    suspended_at: suspendedAt,
  });
}
