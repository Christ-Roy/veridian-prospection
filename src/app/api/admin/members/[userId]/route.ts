/**
 * Admin API — Member detail
 *
 * PATCH  /api/admin/members/[userId]   → { workspaceId, role }
 *   - Adds the user to workspaceId with role, or updates existing role
 *   - Pass { workspaceId, remove: true } to remove the user from that workspace
 * DELETE /api/admin/members/[userId]   → remove the user from ALL workspaces in this tenant
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, invalidateUserContext } from "@/lib/supabase/user-context";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { userId } = await params;
  const body = await request.json().catch(() => ({}));
  const workspaceId: string | undefined = body.workspaceId;
  const role: "admin" | "member" = body.role === "admin" ? "admin" : "member";
  const remove: boolean = body.remove === true;

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // Security: the workspace must belong to the admin's tenant
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, tenantId: auth.ctx.tenantId },
  });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (remove) {
    // Protect the tenant owner: cannot be removed from any workspace admin role
    if (userId === auth.ctx.tenantOwnerId) {
      return NextResponse.json(
        { error: "Cannot remove tenant owner" },
        { status: 400 }
      );
    }
    await prisma.workspaceMember.deleteMany({
      where: { workspaceId, userId },
    });
    invalidateUserContext(userId);
    return NextResponse.json({ ok: true, removed: true });
  }

  // Upsert membership
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId } },
    update: { role },
    create: { workspaceId, userId, role },
  });

  invalidateUserContext(userId);
  return NextResponse.json({ ok: true, workspaceId, userId, role });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { userId } = await params;

  if (userId === auth.ctx.tenantOwnerId) {
    return NextResponse.json(
      { error: "Cannot remove tenant owner" },
      { status: 400 }
    );
  }

  // Remove from all workspaces in this tenant
  const workspaces = await prisma.workspace.findMany({
    where: { tenantId: auth.ctx.tenantId },
    select: { id: true },
  });
  const wsIds = workspaces.map((w) => w.id);

  const deleted = await prisma.workspaceMember.deleteMany({
    where: { userId, workspaceId: { in: wsIds } },
  });

  invalidateUserContext(userId);
  return NextResponse.json({ ok: true, removedFrom: deleted.count });
}
