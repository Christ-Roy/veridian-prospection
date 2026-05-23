/**
 * POST /api/tenants/{id}/sync-member — CONTRAT-HUB v1.5 §5.18.3.
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Voie admin / migration (tenant-level). Pour la voie user-side invitation,
 * utiliser `/api/veridian/workspaces/{id}/attach-member` (§5.22).
 *
 * Comportement obligatoire :
 *  1. `resolveOrCreateUserFromHub({ hubUserId, email })` → user local.
 *  2. Workspace par défaut du tenant = premier créé (createdAt ASC). Si aucun,
 *     en crée un (slug `default`, ce user comme `createdBy`).
 *  3. Si workspace_member existe (deletedAt null) :
 *     - Si role demandé > role actuel → upgrade (additif).
 *     - Sinon idempotent (jamais de downgrade).
 *  4. Si soft-deleted → on relève deletedAt et applique le role.
 *  5. Si pas membre → crée avec `visibility_scope='own'` (restrictif par défaut).
 *
 * Erreurs :
 *  - 404 `tenant_not_found`
 *  - 422 `email_invalid`
 *  - 400 `invalid_body`
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHubHmac } from "@/lib/hub/auth";
import { resolveOrCreateUserFromHub } from "@/lib/hub/identity";
import { resolveTenantByIdOrEmail } from "@/lib/hub/tenant-lookup";
import { logAudit } from "@/lib/audit";
import { ROLE_RANK, type WorkspaceRole } from "@/lib/auth/roles";
import { emitHubWebhookAsync } from "@/lib/hub/webhooks";

const SyncMemberSchema = z.object({
  user_email: z.string().email().max(254),
  hub_user_id: z.string().uuid(),
  role: z.enum(["member", "admin"]).default("member"),
  invited_at: z.string().optional(),
  joined_at: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireHubHmac<unknown>(request);
  if (!auth.ok) return auth.response;

  const parsed = SyncMemberSchema.safeParse(auth.body);
  if (!parsed.success) {
    const isEmail = parsed.error.issues.some((i) =>
      i.path.includes("user_email"),
    );
    return NextResponse.json(
      {
        error: isEmail ? "email_invalid" : "invalid_body",
        message: parsed.error.message,
      },
      { status: isEmail ? 422 : 400 },
    );
  }
  const body = parsed.data;
  const { id: tenantIdParam } = await ctx.params;

  // Le Hub peut envoyer soit l'UUID local soit l'email owner — historiquement
  // `POST /api/tenants/provision` retourne `tenant_id: <owner_email>`.
  // Cf todo/2026-05-21-tenant-id-accept-email-or-uuid.md (Option B Robert).
  const tenant = await resolveTenantByIdOrEmail(tenantIdParam);
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  // Toute la suite utilise l'UUID local résolu, JAMAIS `tenantIdParam`.
  const tenantId = tenant.id;

  const { id: localUserId } = await resolveOrCreateUserFromHub({
    hubUserId: body.hub_user_id,
    email: body.user_email,
  });

  // Workspace par défaut = premier workspace créé pour ce tenant.
  // Cas pathologique : aucun workspace → on crée `default` avec ce user.
  let workspace = await prisma.workspace.findFirst({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        tenantId,
        name: "Default",
        slug: "default",
        createdBy: localUserId,
      },
      select: { id: true },
    });
  }

  const existing = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: workspace.id, userId: localUserId },
    },
    select: { role: true, deletedAt: true },
  });

  let appRole: WorkspaceRole = body.role;
  let roleAction: "created" | "upgraded" | "restored" | "noop" = "created";

  if (existing && !existing.deletedAt) {
    const currentRank = ROLE_RANK[existing.role as WorkspaceRole] ?? 0;
    const targetRank = ROLE_RANK[body.role] ?? 0;
    if (targetRank > currentRank) {
      await prisma.workspaceMember.update({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: localUserId,
          },
        },
        data: { role: body.role },
      });
      appRole = body.role;
      roleAction = "upgraded";
    } else {
      // Idempotent — jamais de downgrade.
      appRole = (existing.role as WorkspaceRole) || body.role;
      roleAction = "noop";
    }
  } else if (existing && existing.deletedAt) {
    // Re-sync après soft-delete : relève deletedAt et applique le role demandé.
    await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: localUserId,
        },
      },
      data: { role: body.role, deletedAt: null, joinedAt: new Date() },
    });
    appRole = body.role;
    roleAction = "restored";
  } else {
    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: localUserId,
        role: body.role,
        visibilityScope: "own",
      },
    });
    appRole = body.role;
    roleAction = "created";
  }

  await logAudit({
    tenantId,
    actorId: null,
    actorType: "hub",
    action: "member.synced_from_hub",
    targetType: "workspace_member",
    targetId: localUserId,
    metadata: {
      hub_user_id: body.hub_user_id,
      workspace_id: workspace.id,
      role: appRole,
      action: roleAction,
    },
  });

  console.log(
    `[sync-member] tenant=${tenantId} workspace=${workspace.id} ` +
      `user=${localUserId} role=${appRole} action=${roleAction}`,
  );

  // §7.1 v1.4 — émettre tenant.member_added lors d'une vraie addition (création
  // ou restauration). Skip sur upgrade/noop : la mutation rôle est déjà
  // tracée par `tenant.member_role_changed` côté admin endpoint.
  if (roleAction === "created" || roleAction === "restored") {
    emitHubWebhookAsync("tenant.member_added", tenantId, {
      workspace_id: workspace.id,
      user_id: localUserId,
      hub_user_id: body.hub_user_id,
      email: body.user_email,
      role: appRole,
      action: roleAction,
    });
  }

  return NextResponse.json({
    tenant_id: tenantId,
    user_email: body.user_email,
    synced: true,
    app_user_id: localUserId,
    app_role: appRole,
  });
}
