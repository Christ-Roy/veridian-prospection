/**
 * POST /api/tenants/{id}/restore-member — CONTRAT-HUB v1.5 §5.20.
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Annule le soft delete pour ce user sur tous les workspaces du tenant.
 * Idempotent : si rien à restaurer, 200 avec affected_workspaces=0.
 *
 * Symétrique à `/remove-member` — même format d'identité (email ou hub_user_id).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHubHmac } from "@/lib/hub/auth";
import { resolveTenantByIdOrEmail } from "@/lib/hub/tenant-lookup";
import { logAudit } from "@/lib/audit";

const RestoreMemberSchema = z
  .object({
    user_email: z.string().email().max(254).optional(),
    hub_user_id: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.user_email || d.hub_user_id), {
    message: "user_email or hub_user_id required",
  });

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireHubHmac<unknown>(request);
  if (!auth.ok) return auth.response;

  const parsed = RestoreMemberSchema.safeParse(auth.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", message: parsed.error.message },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const { id: tenantIdParam } = await ctx.params;

  // Accepte UUID local OU email owner (cf todo/tenant-id-accept-email-or-uuid).
  const tenant = await resolveTenantByIdOrEmail(tenantIdParam);
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  const tenantId = tenant.id;

  let user = body.hub_user_id
    ? await prisma.user.findUnique({
        where: { hubUserId: body.hub_user_id },
        select: { id: true, email: true },
      })
    : null;
  if (!user && body.user_email) {
    user = await prisma.user.findUnique({
      where: { email: body.user_email },
      select: { id: true, email: true },
    });
  }

  if (!user) {
    return NextResponse.json({
      tenant_id: tenantId,
      user_email: body.user_email ?? null,
      restored: true,
      affected_workspaces: 0,
    });
  }

  const workspaces = await prisma.workspace.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true },
  });
  const wsIds = workspaces.map((w) => w.id);

  if (wsIds.length === 0) {
    return NextResponse.json({
      tenant_id: tenantId,
      user_email: user.email,
      restored: true,
      affected_workspaces: 0,
    });
  }

  const result = await prisma.workspaceMember.updateMany({
    where: {
      userId: user.id,
      workspaceId: { in: wsIds },
      deletedAt: { not: null },
    },
    data: { deletedAt: null },
  });

  await logAudit({
    tenantId,
    actorId: null,
    actorType: "hub",
    action: "member.restored_via_hub",
    targetType: "workspace_member",
    targetId: user.id,
    metadata: {
      user_email: user.email,
      affected_workspaces: result.count,
    },
  });

  console.log(
    `[restore-member] tenant=${tenantId} user=${user.id} affected=${result.count}`,
  );

  return NextResponse.json({
    tenant_id: tenantId,
    user_email: user.email,
    restored: true,
    affected_workspaces: result.count,
  });
}
