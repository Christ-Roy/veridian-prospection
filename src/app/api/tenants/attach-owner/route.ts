/**
 * POST /api/tenants/attach-owner — contrat §5.3
 *
 * Auth : HMAC Hub (pattern A §6.1).
 *
 * Comportement : crée ou upgrade le user `owner_email` comme membre `owner`
 * du workspace Default du tenant. **Additif uniquement** (jamais d'écrasement
 * d'owner existant) — pour le transfert d'ownership voir endpoint v2
 * `transfer-owner` (roadmap).
 *
 * Side-effect : crée le user en table prisma `users` s'il n'existait pas.
 * Ne crée PAS de session Supabase / magic_link ici (utiliser
 * /api/workspaces.generateMagicLink P3 séparément).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireHubHmac } from "@/lib/hub/auth";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

type AttachBody = {
  tenant_id?: string;
  owner_email?: string;
  role?: "owner" | "admin";
};

const ALLOWED_ROLES = new Set(["owner", "admin"]);

export async function POST(request: NextRequest) {
  const auth = await requireHubHmac<AttachBody>(request);
  if (!auth.ok) return auth.response;

  const { tenant_id, owner_email, role = "owner" } = auth.body;
  if (!tenant_id || !owner_email) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "tenant_id and owner_email are required",
      },
      { status: 400 },
    );
  }
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: `role must be one of: ${[...ALLOWED_ROLES].join(", ")}`,
      },
      { status: 400 },
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenant_id },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json(
      { error: "tenant_not_found" },
      { status: 404 },
    );
  }

  // 1) Upsert user — on accepte un user existant matché par email.
  const existing = await prisma.user.findFirst({
    where: { email: owner_email },
    select: { id: true },
  });
  const userId = existing?.id ?? randomUUID();
  if (!existing) {
    await prisma.user.create({
      data: { id: userId, email: owner_email, supabaseUserId: userId },
    });
  }

  // 2) Workspace "default" upsert
  let workspace = await prisma.workspace.findFirst({
    where: { tenantId: tenant_id, slug: "default" },
    select: { id: true },
  });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        tenantId: tenant_id,
        name: "Default",
        slug: "default",
        createdBy: userId,
      },
      select: { id: true },
    });
  }

  // 3) Membership : additif uniquement.
  //    - Si pas membre : crée avec le role demandé.
  //    - Si membre avec role <= demandé : upgrade au role demandé.
  //    - Si membre avec role >= demandé : on n'écrase pas.
  const ROLE_RANK: Record<string, number> = {
    viewer: 0,
    member: 1,
    admin: 2,
    owner: 3,
  };
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
    select: { role: true },
  });

  let alreadyAttached = false;
  let finalRole = role;
  if (!member) {
    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId,
        role,
        visibilityScope: "all",
      },
    });
  } else {
    const currentRank = ROLE_RANK[member.role] ?? 0;
    const targetRank = ROLE_RANK[role] ?? 0;
    if (currentRank < targetRank) {
      await prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
        data: { role },
      });
    } else {
      alreadyAttached = true;
      finalRole = member.role as "owner" | "admin";
    }
  }

  console.log(
    `[attach-owner] tenant=${tenant_id} user=${userId} role=${finalRole} alreadyAttached=${alreadyAttached}`,
  );

  return NextResponse.json({
    tenant_id,
    owner_email,
    user_id: userId,
    attached: !alreadyAttached,
    already_attached: alreadyAttached,
    role: finalRole,
  });
}
