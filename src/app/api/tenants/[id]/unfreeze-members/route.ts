/**
 * POST /api/tenants/{id}/unfreeze-members — CONTRAT-HUB v1.5 §5.21.
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Body : `{ user_emails: string[] }`. Symétrique à `/freeze-members` —
 * remet `frozen_at = NULL` sur tous les workspace_members concernés.
 *
 * Idempotent : si rien à dégeler, 200 avec affected_members=0.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHubHmac } from "@/lib/hub/auth";
import { resolveTenantByIdOrEmail } from "@/lib/hub/tenant-lookup";
import { logAudit } from "@/lib/audit";

const UnfreezeMembersSchema = z.object({
  user_emails: z.array(z.string().email().max(254)).min(1).max(1000),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireHubHmac<unknown>(request);
  if (!auth.ok) return auth.response;

  const parsed = UnfreezeMembersSchema.safeParse(auth.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", message: parsed.error.message },
      { status: 400 },
    );
  }
  const { user_emails } = parsed.data;
  const { id: tenantIdParam } = await ctx.params;

  // Accepte UUID local OU email owner (cf todo/tenant-id-accept-email-or-uuid).
  const tenant = await resolveTenantByIdOrEmail(tenantIdParam);
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  const tenantId = tenant.id;

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
      unfrozen_emails: users.map((u) => u.email),
      affected_members: 0,
    });
  }

  const result = await prisma.workspaceMember.updateMany({
    where: {
      userId: { in: userIds },
      workspaceId: { in: wsIds },
      frozenAt: { not: null },
    },
    data: { frozenAt: null },
  });

  await logAudit({
    tenantId,
    actorId: null,
    actorType: "hub",
    action: "members.unfrozen_via_hub",
    targetType: "tenant",
    targetId: tenantId,
    metadata: {
      user_emails: users.map((u) => u.email),
      affected_members: result.count,
    },
  });

  console.log(
    `[unfreeze-members] tenant=${tenantId} users=${userIds.length} affected=${result.count}`,
  );

  return NextResponse.json({
    tenant_id: tenantId,
    unfrozen_emails: users.map((u) => u.email),
    affected_members: result.count,
  });
}
