/**
 * POST /api/tenants/{id}/freeze-members — CONTRAT-HUB v1.5 §5.21.
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Body : `{ user_emails: string[] }` — chaque email passe en mode dégradé
 * paywall sur tous ses workspace_members du tenant (frozen_at = NOW()).
 *
 * Effets côté Prospection :
 *  - obfuscation des SENSITIVE_FIELDS sur GET /api/leads/* (cf
 *    src/lib/auth/freeze.ts → isUserFrozen)
 *  - 402 sur les écritures (handlers à câbler progressivement, pour l'instant
 *    seule la lecture obfusquée est appliquée comme baseline §5.9)
 *
 * Idempotent : si un user n'est pas membre du tenant, on l'ignore silencieusement.
 * Ne touche pas aux workspace_members déjà soft-deleted.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHubHmac } from "@/lib/hub/auth";
import { logAudit } from "@/lib/audit";

const FreezeMembersSchema = z.object({
  user_emails: z.array(z.string().email().max(254)).min(1).max(1000),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireHubHmac<unknown>(request);
  if (!auth.ok) return auth.response;

  const parsed = FreezeMembersSchema.safeParse(auth.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", message: parsed.error.message },
      { status: 400 },
    );
  }
  const { user_emails } = parsed.data;
  const { id: tenantId } = await ctx.params;

  if (!z.string().uuid().safeParse(tenantId).success) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  const users = await prisma.user.findMany({
    where: { email: { in: user_emails } },
    select: { id: true, email: true },
  });
  const userIds = users.map((u) => u.id);

  const workspaces = await prisma.workspace.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true },
  });
  const wsIds = workspaces.map((w) => w.id);

  if (userIds.length === 0 || wsIds.length === 0) {
    return NextResponse.json({
      tenant_id: tenantId,
      frozen_emails: users.map((u) => u.email),
      affected_members: 0,
    });
  }

  const now = new Date();
  const result = await prisma.workspaceMember.updateMany({
    where: {
      userId: { in: userIds },
      workspaceId: { in: wsIds },
      deletedAt: null,
      frozenAt: null,
    },
    data: { frozenAt: now },
  });

  await logAudit({
    tenantId,
    actorId: null,
    actorType: "hub",
    action: "members.frozen_via_hub",
    targetType: "tenant",
    targetId: tenantId,
    metadata: {
      user_emails: users.map((u) => u.email),
      affected_members: result.count,
    },
  });

  console.log(
    `[freeze-members] tenant=${tenantId} users=${userIds.length} affected=${result.count}`,
  );

  return NextResponse.json({
    tenant_id: tenantId,
    frozen_emails: users.map((u) => u.email),
    affected_members: result.count,
  });
}
