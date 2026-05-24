/**
 * Pipeline stages custom par workspace — source de vérité serveur.
 *
 * Avant ce module, le kanban /pipeline et la lead-sheet stage-transition
 * lisaient une constante hardcodée `PIPELINE_STAGES` (src/lib/types.ts).
 * Impossible à customiser par tenant → bloquait la commercialisation aux
 * agences B2B verticales qui ont leur propre workflow.
 *
 * Maintenant : table `workspace_pipeline_stages` (1 row par stage par
 * workspace). Au seed de la migration 0020, on insère les 8 stages
 * canoniques pour chaque workspace existant — comportement strictement
 * identique pour les clients en place. Les workspaces créés APRÈS la
 * migration reçoivent leurs stages via `seedDefaultPipelineStages()` ci-
 * dessous, appelé par chaque API qui crée un workspace.
 *
 * Toute lecture côté API filtre par `workspace_id = activeWorkspaceId(user)`
 * — pas de cross-tenant, jamais.
 */

import type { PrismaClient } from "@prisma/client";

/**
 * 8 stages canoniques historiques — mêmes valeurs que la constante
 * PIPELINE_STAGES qui existait dans src/lib/types.ts avant la migration.
 *
 * Servent à 2 endroits :
 *  1. La migration 0020 SQL fait un INSERT SELECT depuis cette liste pour
 *     les workspaces existants au moment du run (impérativement dans le
 *     fichier SQL, pas via ce TS — la migration tourne en pur SQL).
 *  2. Le helper `seedDefaultPipelineStages()` ci-dessous re-insère ces 8
 *     stages quand un workspace est créé après la migration (création via
 *     /api/admin/workspaces, /api/tenants/attach-owner, /api/tenants/
 *     provision, /api/tenants/[id]/sync-member).
 *
 * Source unique pour garder SQL + TS synchros à un seul endroit.
 */
export const DEFAULT_PIPELINE_STAGES = [
  { slug: "fiche_ouverte", label: "Fiche ouverte", position: 0, color: "bg-indigo-500" },
  { slug: "repondeur",     label: "Répondeur",     position: 1, color: "bg-sky-500" },
  { slug: "a_rappeler",    label: "À rappeler",    position: 2, color: "bg-orange-500" },
  { slug: "site_demo",     label: "Site démo",     position: 3, color: "bg-purple-500" },
  { slug: "acompte",       label: "Acompte",       position: 4, color: "bg-emerald-500" },
  { slug: "finition",      label: "Finition",      position: 5, color: "bg-teal-500" },
  { slug: "client",        label: "Client",        position: 6, color: "bg-yellow-500" },
  { slug: "upsell",        label: "Upsell SaaS",   position: 7, color: "bg-rose-500" },
] as const;

export type PipelineStageRow = {
  id: string;
  slug: string;
  label: string;
  position: number;
  color: string | null;
  isTerminal: boolean;
  isHidden: boolean;
};

/**
 * Slugify côté serveur. Lowercase snake_case, ascii only, max 64 char.
 * Retourne une chaîne vide si rien d'utilisable (le caller doit fallback).
 */
export function slugifyStage(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/**
 * Insère les 8 stages canoniques pour un workspace fraîchement créé.
 * Idempotent via skipDuplicates (le code peut ré-appeler safely).
 *
 * À appeler depuis CHAQUE point d'entrée qui crée un workspace, sinon le
 * workspace nait sans colonnes kanban et le /pipeline affiche un board
 * vide pour ce client.
 */
export async function seedDefaultPipelineStages(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<void> {
  await prisma.workspacePipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((s) => ({
      workspaceId,
      slug: s.slug,
      label: s.label,
      position: s.position,
      color: s.color,
    })),
    skipDuplicates: true,
  });
}

/**
 * Lit les stages actifs (non soft-deleted) d'un workspace, triés par
 * position. À utiliser dans les API qui rendent le kanban et la lead-sheet.
 */
export async function listWorkspacePipelineStages(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<PipelineStageRow[]> {
  const rows = await prisma.workspacePipelineStage.findMany({
    where: { workspaceId, deletedAt: null },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      slug: true,
      label: true,
      position: true,
      color: true,
      isTerminal: true,
      isHidden: true,
    },
  });
  return rows;
}

/**
 * Compte le nombre de leads (outreach) encore positionnés sur un stage
 * donné, scoped au workspace. Utilisé par l'API DELETE pour refuser un
 * soft-delete qui orphaniserait des leads.
 */
export async function countLeadsOnStage(
  prisma: PrismaClient,
  workspaceId: string,
  slug: string,
): Promise<number> {
  return prisma.outreach.count({
    where: { workspaceId, pipelineStage: slug },
  });
}
