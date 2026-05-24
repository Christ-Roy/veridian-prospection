/**
 * POST /api/tenants/{id}/remove-member — CONTRAT-HUB v1.5 §5.19.
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Soft delete sur TOUS les workspace_members du user pour les workspaces de
 * ce tenant (1 user peut être dans plusieurs workspaces du même tenant).
 *
 * Garde-fou : refuse si user = owner du tenant (`tenants.user_id`) → 409
 * `cannot_remove_owner`. Pour transférer l'ownership, utiliser un endpoint
 * dédié (roadmap).
 *
 * Identité user : on accepte `user_email` OU `hub_user_id` (défense). On
 * essaie hub_user_id en priorité s'il est fourni (clé stable cross-app).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHubHmac } from "@/lib/hub/auth";
import { resolveTenantByIdOrEmail } from "@/lib/hub/tenant-lookup";
import { logAudit } from "@/lib/audit";
import { enqueueEvent } from "@/lib/hub-webhook/outbox";

const RemoveMemberSchema = z
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

  const parsed = RemoveMemberSchema.safeParse(auth.body);
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

  // Résoudre user local : priorité hub_user_id (stable), fallback email.
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
    // Idempotent : pas de user local = rien à retirer.
    return NextResponse.json({
      tenant_id: tenantId,
      user_email: body.user_email ?? null,
      removed: true,
      affected_workspaces: 0,
    });
  }

  if (user.id === tenant.userId) {
    return NextResponse.json(
      {
        error: "cannot_remove_owner",
        message:
          "user is the tenant owner — transfer ownership before removing",
      },
      { status: 409 },
    );
  }

  // Tous les workspaces du tenant (incluant soft-deleted workspaces ? non,
  // ne pas toucher aux workspaces soft-deleted, ils sont déjà inactifs).
  const workspaces = await prisma.workspace.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true },
  });
  const wsIds = workspaces.map((w) => w.id);

  if (wsIds.length === 0) {
    return NextResponse.json({
      tenant_id: tenantId,
      user_email: user.email,
      removed: true,
      affected_workspaces: 0,
    });
  }

  // Atomicité mutation + outbox : la soft-delete des memberships et l'enqueue
  // sont dans la même transaction. Si l'enqueue échoue, les memberships
  // ne sont pas soft-deletées → pas de désync Hub ↔ Prospection.
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.workspaceMember.updateMany({
      where: {
        userId: user!.id,
        workspaceId: { in: wsIds },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    // §7.1 v1.4 — émettre tenant.member_removed si au moins une membership a
    // bien été soft-deletée (sinon noop : already-removed = pas d'event).
    if (updated.count > 0) {
      await enqueueEvent(tx, "tenant.member_removed", tenantId, {
        user_id: user!.id,
        email: user!.email,
        affected_workspaces: updated.count,
      });
    }

    return updated;
  });

  await logAudit({
    tenantId,
    actorId: null,
    actorType: "hub",
    action: "member.removed_via_hub",
    targetType: "workspace_member",
    targetId: user.id,
    metadata: {
      user_email: user.email,
      affected_workspaces: result.count,
    },
  });

  console.log(
    `[remove-member] tenant=${tenantId} user=${user.id} affected=${result.count}`,
  );

  return NextResponse.json({
    tenant_id: tenantId,
    user_email: user.email,
    removed: true,
    affected_workspaces: result.count,
  });
}
