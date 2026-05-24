/**
 * POST /api/workspaces/[id]/pipeline-stages/reorder
 *
 * Bulk update des positions après un drag-and-drop côté UI.
 * Body: { order: string[] }  ← liste des stage IDs dans le nouvel ordre.
 *
 * Transactionnel : si une seule ligne échoue, rollback complet — évite
 * une race où la moitié des positions sont à jour et l'autre non
 * (kanban affiché dans un état incohérent).
 *
 * Sécu : admin/owner workspace uniquement. Tous les stage IDs du body
 * doivent appartenir au workspace de l'URL (refus sinon, pas reorder
 * partiel d'un sous-ensemble).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";

function userIsAdminOfWorkspace(
  ctx: { isAdmin: boolean; workspaces: { id: string; role: string }[] },
  workspaceId: string,
): boolean {
  if (ctx.isAdmin) return true;
  const m = ctx.workspaces.find((w) => w.id === workspaceId);
  return m?.role === "admin" || m?.role === "owner";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  if (!userIsAdminOfWorkspace(auth.ctx, id)) {
    return NextResponse.json(
      { error: "Forbidden: admin role required" },
      { status: 403 },
    );
  }

  const ws = await prisma.workspace.findFirst({
    where: { id, tenantId: auth.ctx.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const order: unknown = body?.order;
  if (!Array.isArray(order) || order.some((x) => typeof x !== "string")) {
    return NextResponse.json(
      { error: "order must be an array of stage IDs" },
      { status: 400 },
    );
  }
  if (order.length === 0) {
    return NextResponse.json({ error: "order is empty" }, { status: 400 });
  }
  if (order.length > 100) {
    return NextResponse.json({ error: "order too long" }, { status: 400 });
  }

  // Vérifie que tous les IDs appartiennent au workspace courant et sont
  // actifs (non soft-deleted). Refus complet sinon — on n'écrit pas un
  // reorder partiel.
  const stageIds = order as string[];
  const stages = await prisma.workspacePipelineStage.findMany({
    where: { id: { in: stageIds }, workspaceId: id, deletedAt: null },
    select: { id: true },
  });
  if (stages.length !== stageIds.length) {
    return NextResponse.json(
      { error: "some stage IDs not found in this workspace" },
      { status: 400 },
    );
  }

  // Bulk update transactionnel : 1 update par row, dans une seule
  // transaction Prisma. Pour <100 rows, plus simple et plus sûr qu'un
  // CASE WHEN raw SQL — et l'index (workspace_id, position) reste utilisé.
  await prisma.$transaction(
    stageIds.map((stageId, position) =>
      prisma.workspacePipelineStage.update({
        where: { id: stageId },
        data: { position },
      }),
    ),
  );

  return NextResponse.json({ ok: true, count: stageIds.length });
}
