/**
 * Admin API — Workspace detail
 *
 * PATCH  /api/admin/workspaces/[id]   → rename workspace { name?, slug? }
 * DELETE /api/admin/workspaces/[id]   → delete workspace (members cascaded, rows re-assigned to Default)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, invalidateAllUserContexts } from "@/lib/supabase/user-context";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const existing = await prisma.workspace.findFirst({
    where: { id, tenantId: auth.ctx.tenantId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const data: { name?: string; slug?: string } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.slug === "string" && body.slug.trim()) data.slug = body.slug.trim();

  const updated = await prisma.workspace.update({ where: { id }, data });

  invalidateAllUserContexts();
  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const existing = await prisma.workspace.findFirst({
    where: { id, tenantId: auth.ctx.tenantId },
  });
  if (!existing) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (existing.slug === "default") {
    return NextResponse.json(
      { error: "Cannot delete the Default workspace" },
      { status: 400 }
    );
  }

  // Find the default workspace to reassign orphan rows
  const defaultWs = await prisma.workspace.findFirst({
    where: { tenantId: auth.ctx.tenantId, slug: "default" },
  });

  // Re-assign metier rows to the default workspace if it exists, else null
  const reassignId = defaultWs?.id ?? null;

  await prisma.$transaction([
    prisma.outreach.updateMany({
      where: { tenantId: auth.ctx.tenantId, workspaceId: id },
      data: { workspaceId: reassignId },
    }),
    prisma.callLog.updateMany({
      where: { tenantId: auth.ctx.tenantId, workspaceId: id },
      data: { workspaceId: reassignId },
    }),
    prisma.followup.updateMany({
      where: { tenantId: auth.ctx.tenantId, workspaceId: id },
      data: { workspaceId: reassignId },
    }),
    prisma.claudeActivity.updateMany({
      where: { tenantId: auth.ctx.tenantId, workspaceId: id },
      data: { workspaceId: reassignId },
    }),
    prisma.workspace.delete({ where: { id } }),
  ]);

  invalidateAllUserContexts();
  return NextResponse.json({ ok: true, reassignedTo: reassignId });
}
