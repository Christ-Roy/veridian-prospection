/**
 * Pipeline stages custom — list + create
 *
 * GET  /api/workspaces/[id]/pipeline-stages
 *      Liste les stages actifs du workspace, triés par position.
 *      Lecture autorisée à tout membre du workspace (le kanban lit ça).
 *
 * POST /api/workspaces/[id]/pipeline-stages
 *      Crée un nouveau stage (admin/owner uniquement). Slug auto-généré
 *      depuis le label si non fourni, unique par workspace.
 *      Body: { label: string, color?: string, isTerminal?: boolean,
 *              isHidden?: boolean, position?: number, slug?: string }
 *
 * Sécu cross-tenant : l'`id` du path DOIT correspondre à un workspace que
 * l'user a accès (workspaces du UserContext). Sinon 403 — pas de leak du
 * fait qu'un workspace existe ailleurs.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import {
  listWorkspacePipelineStages,
  slugifyStage,
} from "@/lib/outreach/pipeline-stages";

function userIsAdminOfWorkspace(
  ctx: { isAdmin: boolean; workspaces: { id: string; role: string }[] },
  workspaceId: string,
): boolean {
  if (ctx.isAdmin) return true;
  const m = ctx.workspaces.find((w) => w.id === workspaceId);
  return m?.role === "admin" || m?.role === "owner";
}

function userBelongsToWorkspace(
  ctx: { isAdmin: boolean; workspaces: { id: string }[] },
  workspaceId: string,
): boolean {
  if (ctx.isAdmin) return true;
  return ctx.workspaces.some((w) => w.id === workspaceId);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  // Garde cross-tenant : avant tout DB lookup, on vérifie via le contexte
  // résolu serveur. Un user qui force un id arbitraire dans l'URL doit
  // recevoir 403, pas 200 avec un payload vide (= leak d'inférence).
  if (!userBelongsToWorkspace(auth.ctx, id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Double-vérification : l'id passé existe ET est dans le tenant de l'user.
  // (couvre le cas isAdmin=true cross-tenant — un admin tenant A ne doit
  // pas voir les stages d'un workspace tenant B.)
  const ws = await prisma.workspace.findFirst({
    where: { id, tenantId: auth.ctx.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const stages = await listWorkspacePipelineStages(prisma, id);
  return NextResponse.json({ stages });
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
  const label: string = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  if (label.length > 80) {
    return NextResponse.json(
      { error: "label too long (80 chars max)" },
      { status: 400 },
    );
  }

  let slug =
    typeof body?.slug === "string" && body.slug.trim()
      ? slugifyStage(body.slug)
      : slugifyStage(label);
  if (!slug) slug = `stage_${Date.now()}`;

  // Unicité par workspace — préfixer en cas de collision plutôt que 409.
  // Pattern aligné sur le slug workspace (cf src/app/api/admin/workspaces/route.ts).
  let finalSlug = slug;
  let i = 2;
  while (
    await prisma.workspacePipelineStage.findFirst({
      where: { workspaceId: id, slug: finalSlug, deletedAt: null },
    })
  ) {
    finalSlug = `${slug}_${i++}`;
    if (i > 100) break;
  }

  // Position : si fournie, on l'utilise ; sinon, last + 1.
  let position: number;
  if (typeof body?.position === "number" && Number.isFinite(body.position)) {
    position = Math.max(0, Math.floor(body.position));
  } else {
    const last = await prisma.workspacePipelineStage.findFirst({
      where: { workspaceId: id, deletedAt: null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    position = (last?.position ?? -1) + 1;
  }

  const color =
    typeof body?.color === "string" && body.color.trim()
      ? body.color.trim().slice(0, 32)
      : null;

  const stage = await prisma.workspacePipelineStage.create({
    data: {
      workspaceId: id,
      slug: finalSlug,
      label,
      position,
      color,
      isTerminal: Boolean(body?.isTerminal),
      isHidden: Boolean(body?.isHidden),
    },
  });

  return NextResponse.json(
    {
      id: stage.id,
      slug: stage.slug,
      label: stage.label,
      position: stage.position,
      color: stage.color,
      isTerminal: stage.isTerminal,
      isHidden: stage.isHidden,
    },
    { status: 201 },
  );
}
