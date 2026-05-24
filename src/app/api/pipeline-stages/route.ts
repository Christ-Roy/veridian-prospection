/**
 * GET /api/pipeline-stages
 *
 * Endpoint pratique côté client : retourne les stages du workspace
 * actif de l'utilisateur courant (résolu via cookie `active_workspace_id`
 * et UserContext serveur). Le hook `useWorkspacePipelineStages` appelle
 * cette route — pas besoin d'exposer un workspaceId côté client.
 *
 * Pour les actions admin (create/edit/delete/reorder), utiliser les
 * routes `/api/workspaces/[id]/pipeline-stages/...` qui prennent le
 * workspace ID explicitement (UI /settings/pipeline).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";
import { listWorkspacePipelineStages } from "@/lib/outreach/pipeline-stages";

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const activeId = auth.ctx.activeWorkspaceId;
  if (!activeId) {
    // Pas de workspace actif (cas pathologique — un user sans aucune
    // adhésion). On renvoie une liste vide, le hook client retombe sur
    // la liste legacy (8 canoniques) en fallback.
    return NextResponse.json(
      { stages: [] },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  }

  const stages = await listWorkspacePipelineStages(prisma, activeId);
  return NextResponse.json(
    { stages },
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
}
