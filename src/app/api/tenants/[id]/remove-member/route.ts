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
import { oublierFils } from "@/lib/hub/ia-fils";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHubHmac } from "@/lib/hub/auth";
import { resolveTenantByIdOrEmail } from "@/lib/hub/tenant-lookup";
import { logAudit } from "@/lib/audit";
import { revoquerClesDe } from "@/atlas/acces";
import { invalidateAllUserContexts } from "@/lib/auth/cache-contexte";

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

  // Avant la coupure de l'appartenance, et même si elle est déjà faite : une clé créée par un retiré ne revient jamais.
  const clesRevoquees = await revoquerClesDe(user.id, tenantId);
  // §5.24 : les fils « Mon IA » de la personne dans cet espace partent avec elle, même chemin que les clés.
  const fils = await oublierFils(tenantId, user.id);
  // Ce que le Hub montre à l'auteur du geste (avisCles) : les clés de l'espace qui restent actives, et où les gérer.
  const clesActives = () => prisma.atlasCleApi.count({ where: { tenantId, revoqueeLe: null } });
  const lienCles = `${process.env.APP_URL || "https://prospection.app.veridian.site"}/`;

  if (wsIds.length === 0) {
    return NextResponse.json({
      tenant_id: tenantId,
      user_email: user.email,
      removed: true,
      affected_workspaces: 0,
      revoked_api_keys: clesRevoquees,
      active_api_keys: await clesActives(),
      active_api_keys_created_by_member: 0,
      api_keys_url: lienCles,
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
    `[remove-member] tenant=${tenantId} user=${user.id} affected=${result.count} cles=${clesRevoquees} fils=${fils}`,
  );

  // Effet immédiat sur cette instance ; les autres suivent en 3 s (CACHE_TTL_MS).
  invalidateAllUserContexts();
  return NextResponse.json({
    tenant_id: tenantId,
    user_email: user.email,
    removed: true,
    affected_workspaces: result.count,
    revoked_api_keys: clesRevoquees,
    active_api_keys: await clesActives(),
    active_api_keys_created_by_member: 0,
    api_keys_url: lienCles,
  });
}
