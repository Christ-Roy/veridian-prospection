import { PipelineStagesSettings } from "@/components/dashboard/pipeline-stages-settings";
import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth/user-context";

export const dynamic = "force-dynamic";

export default async function PipelineSettingsPage() {
  // Page admin/owner only — on filtre côté serveur pour ne pas afficher
  // d'UI à un member qui n'a aucun bouton actif (UX brouillonne sinon).
  // L'API garde ses propres checks côté serveur (defense in depth).
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");

  const activeWs = ctx.workspaces.find((w) => w.id === ctx.activeWorkspaceId) ?? ctx.workspaces[0];
  if (!activeWs) {
    return (
      <div className="p-6 max-w-3xl">
        <h1 className="text-xl font-semibold">Pipeline</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Aucun workspace actif. Demande à ton admin de t'ajouter à un workspace.
        </p>
      </div>
    );
  }

  const canEdit = ctx.isAdmin || activeWs.role === "admin" || activeWs.role === "owner";

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Pipeline — étapes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Personnalise les colonnes du kanban {activeWs.name}. Renomme,
          réordonne par glisser-déposer, ajoute des étapes propres à ton
          workflow.
        </p>
      </div>
      <PipelineStagesSettings workspaceId={activeWs.id} canEdit={canEdit} />
    </div>
  );
}
