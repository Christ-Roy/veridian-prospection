/**
 * Pipeline stage detail — edit + soft-delete
 *
 * PATCH  /api/workspaces/[id]/pipeline-stages/[stageId]
 *        Body: { label?, color?, position?, isTerminal?, isHidden? }
 *        Slug NON modifiable une fois créé (référencé par outreach.pipeline_stage).
 *
 * DELETE /api/workspaces/[id]/pipeline-stages/[stageId]
 *        Soft-delete (deleted_at = NOW()). Refusé si des leads sont encore
 *        sur ce stage — le client doit migrer les leads d'abord.
 *
 * Sécu : admin/owner workspace uniquement pour les mutations.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { countLeadsOnStage } from "@/lib/outreach/pipeline-stages";

function userIsAdminOfWorkspace(
  ctx: { isAdmin: boolean; workspaces: { id: string; role: string }[] },
  workspaceId: string,
): boolean {
  if (ctx.isAdmin) return true;
  const m = ctx.workspaces.find((w) => w.id === workspaceId);
  return m?.role === "admin" || m?.role === "owner";
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id, stageId } = await params;

  if (!userIsAdminOfWorkspace(auth.ctx, id)) {
    return NextResponse.json(
      { error: "Forbidden: admin role required" },
      { status: 403 },
    );
  }

  // Scope strict : le stage doit appartenir AU workspace de l'URL ET dans
  // le tenant de l'user. Deux gardes pour ne pas leak entre tenants.
  const stage = await prisma.workspacePipelineStage.findFirst({
    where: {
      id: stageId,
      workspaceId: id,
      workspace: { tenantId: auth.ctx.tenantId, deletedAt: null },
      deletedAt: null,
    },
  });
  if (!stage) {
    return NextResponse.json({ error: "Stage not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const data: {
    label?: string;
    color?: string | null;
    position?: number;
    isTerminal?: boolean;
    isHidden?: boolean;
  } = {};

  if (typeof body?.label === "string") {
    const label = body.label.trim();
    if (!label) {
      return NextResponse.json({ error: "label cannot be empty" }, { status: 400 });
    }
    if (label.length > 80) {
      return NextResponse.json({ error: "label too long" }, { status: 400 });
    }
    data.label = label;
  }
  if (body?.color === null) {
    data.color = null;
  } else if (typeof body?.color === "string") {
    const c = body.color.trim();
    if (c && c.length > 32) {
      return NextResponse.json({ error: "color too long" }, { status: 400 });
    }
    data.color = c || null;
  }
  if (typeof body?.position === "number" && Number.isFinite(body.position)) {
    data.position = Math.max(0, Math.floor(body.position));
  }
  if (typeof body?.isTerminal === "boolean") data.isTerminal = body.isTerminal;
  if (typeof body?.isHidden === "boolean") data.isHidden = body.isHidden;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const updated = await prisma.workspacePipelineStage.update({
    where: { id: stageId },
    data,
  });

  return NextResponse.json({
    id: updated.id,
    slug: updated.slug,
    label: updated.label,
    position: updated.position,
    color: updated.color,
    isTerminal: updated.isTerminal,
    isHidden: updated.isHidden,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id, stageId } = await params;

  if (!userIsAdminOfWorkspace(auth.ctx, id)) {
    return NextResponse.json(
      { error: "Forbidden: admin role required" },
      { status: 403 },
    );
  }

  const stage = await prisma.workspacePipelineStage.findFirst({
    where: {
      id: stageId,
      workspaceId: id,
      workspace: { tenantId: auth.ctx.tenantId, deletedAt: null },
      deletedAt: null,
    },
  });
  if (!stage) {
    return NextResponse.json({ error: "Stage not found" }, { status: 404 });
  }

  // Garde-fou : si des leads sont encore sur ce slug, on refuse — sinon
  // ils deviennent orphelins (le kanban ne saurait plus où les afficher).
  // Le client est invité à migrer ses leads d'abord, via l'UI.
  const leadCount = await countLeadsOnStage(prisma, id, stage.slug);
  if (leadCount > 0) {
    return NextResponse.json(
      {
        error: "stage_has_leads",
        message: `${leadCount} lead(s) encore sur ce stage. Migrez-les avant de supprimer.`,
        leadCount,
      },
      { status: 409 },
    );
  }

  await prisma.workspacePipelineStage.update({
    where: { id: stageId },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
