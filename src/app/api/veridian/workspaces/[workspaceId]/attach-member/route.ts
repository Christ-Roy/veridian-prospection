/**
 * POST /api/veridian/workspaces/[workspaceId]/attach-member — contrat §5.22 v1.5.
 *
 * Endpoint Hub-only (HMAC standard §6.1) appelé après acceptation d'une
 * invitation cross-app. Crée (ou met à jour) la row WorkspaceMember pour
 * le user invité, puis retourne un magic link auto-login Prospection.
 *
 * Réutilise `resolveOrCreateUserFromHub` (§3.7) pour résoudre/créer le user
 * local à partir de l'identité Hub.
 *
 * Cf veridian-hub/lib/invitations/accept.ts (`TODO(P1-step4b)`) pour le
 * caller côté Hub.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHubHmac } from "@/lib/hub/auth";
import { resolveOrCreateUserFromHub } from "@/lib/hub/identity";
import { logAudit } from "@/lib/audit";
import { ROLE_RANK, type WorkspaceRole } from "@/lib/auth/roles";

const AttachMemberSchema = z.object({
  hub_user_id: z.string().uuid(),
  hub_user_email: z.string().email().max(254),
  role: z.enum(["owner", "admin", "member"]),
  invitation_id: z.string().min(1).max(128),
});

type AttachMemberBody = z.infer<typeof AttachMemberSchema>;

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function appUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://prospection.app.veridian.site"
  );
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const auth = await requireHubHmac<unknown>(request);
  if (!auth.ok) return auth.response;

  const parsed = AttachMemberSchema.safeParse(auth.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", message: parsed.error.message },
      { status: 400 },
    );
  }
  const body: AttachMemberBody = parsed.data;

  const { workspaceId } = await ctx.params;
  // Validation UUID workspace côté nous — sinon une string random partirait
  // dans le findUnique Prisma et bumperait une erreur P2023 peu lisible.
  if (!z.string().uuid().safeParse(workspaceId).success) {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    select: { id: true, tenantId: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: workspace.tenantId },
    select: { status: true, deletedAt: true },
  });
  if (!tenant || tenant.deletedAt) {
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }
  if (tenant.status === "suspended") {
    return NextResponse.json(
      { error: "workspace_suspended" },
      { status: 423 },
    );
  }

  const { id: localUserId } = await resolveOrCreateUserFromHub({
    hubUserId: body.hub_user_id,
    email: body.hub_user_email,
  });

  const existing = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId: workspace.id, userId: localUserId },
    },
    select: { role: true, deletedAt: true },
  });

  let alreadyMember = false;
  let finalRole: WorkspaceRole = body.role;
  let roleChanged = false;

  if (existing && !existing.deletedAt) {
    if (existing.role === body.role) {
      alreadyMember = true;
      finalRole = body.role;
    } else {
      // Source de vérité = Hub invitation. UPDATE le role local + audit.
      await prisma.workspaceMember.update({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: localUserId,
          },
        },
        data: { role: body.role },
      });
      roleChanged = true;
      finalRole = body.role;
    }
  } else if (existing && existing.deletedAt) {
    // Re-attach après soft-delete : on reset deletedAt + role.
    await prisma.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: localUserId,
        },
      },
      data: { role: body.role, deletedAt: null, joinedAt: new Date() },
    });
    finalRole = body.role;
  } else {
    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: localUserId,
        role: body.role,
        visibilityScope: ROLE_RANK[body.role] >= ROLE_RANK.admin ? "all" : "own",
      },
    });
    finalRole = body.role;
  }

  await logAudit({
    tenantId: workspace.tenantId,
    actorId: null,
    actorType: "hub",
    action: "workspace.member.attached_via_hub",
    targetType: "workspace_member",
    targetId: localUserId,
    metadata: {
      hub_user_id: body.hub_user_id,
      invitation_id: body.invitation_id,
      role: finalRole,
      already_member: alreadyMember,
      role_changed: roleChanged,
      workspace_id: workspace.id,
    },
  });

  // Magic link auto-login Prospection — réutilise le mécanisme tenant.
  // prospectionLoginToken / generateMagicLink (cf §5.6).
  const loginToken = randomBytes(32).toString("hex");
  await prisma.tenant.update({
    where: { id: workspace.tenantId },
    data: {
      prospectionLoginToken: loginToken,
      prospectionLoginTokenCreatedAt: new Date(),
      prospectionLoginTokenUsedAt: null,
    },
  });
  const loginUrl = `${appUrl()}/api/auth/token?t=${loginToken}`;
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  // Log structuré sans body sensible (pas hub_user_email en clair).
  console.log(
    `[attach-member] workspace=${workspace.id} hub_user=${body.hub_user_id} ` +
      `local_user=${localUserId} role=${finalRole} already_member=${alreadyMember} ` +
      `role_changed=${roleChanged} invitation=${body.invitation_id}`,
  );

  return NextResponse.json({
    attached: true,
    already_member: alreadyMember,
    member_id: localUserId,
    workspace_id: workspace.id,
    role: finalRole,
    login_url: loginUrl,
    expires_at: expiresAt,
  });
}
