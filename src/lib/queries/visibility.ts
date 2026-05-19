/**
 * Source unique de vérité pour la visibilité des outreach.
 *
 * Avant ce module : chaque query (prospects, historique, pipeline, segments,
 * stats) bricolait son propre filtre user_id / status / workspace_id. Résultat :
 * des bugs métier (cf todo/2026-05-19-audit-bugs-prospect-status-cross-membre.md)
 * où Bob voyait les outreach de Carole dans /historique, et où les leads en
 * négo réapparaissaient dans /prospects.
 *
 * Modèle métier (validé par Robert 2026-05-19) :
 *   - 1 lead = 1 outreach = 1 owner (user_id) = 1 status
 *   - Ouvrir une fiche dans /prospects → fige l'owner (recordVisit)
 *   - Un commercial ne doit JAMAIS voir le lead d'un collègue dans
 *     /prospects, peu importe son visibility_scope (anti double appel)
 *   - L'admin tenant garde un accès "lecture seule" sur tout via flag
 *     explicite (futur dashboard KPI cross-membre).
 *
 * À terme, ce module est le SEUL endroit où on raisonne sur la visibilité
 * d'un outreach. Si tu as besoin d'ajouter une clause, c'est ici.
 */

export type VisibilityMode =
  | "discovery"  // /prospects : leads non touchés OU mes a_contacter à moi
  | "mine"       // /historique, /pipeline : mes outreach uniquement
  | "team"       // visibility_scope='all' : tous les outreach du workspace
  | "admin";     // tenant admin avec flag explicite : tout le tenant

export interface VisibilityScope {
  mode: VisibilityMode;
  tenantId: string;
  userId: string;
  /** Workspaces auxquels appartient le user. null = tous (admin). */
  workspaceIds: string[] | null;
}

/** Échappe un UUID pour l'injection dans une string SQL (whitelisting strict). */
function escUuid(v: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(v)) {
    throw new Error(`invalid uuid for sql interpolation: ${v}`);
  }
  return v;
}

function escUuidList(vals: string[]): string {
  return vals.map((v) => `'${escUuid(v)}'`).join(",");
}

/**
 * Clause SQL à appliquer à la **clause JOIN** outreach.
 * Filtre par tenant_id et (selon le mode) par workspace_id.
 *
 * Usage : `LEFT JOIN outreach o ON o.siren = e.siren ${joinClause}`
 */
export function buildOutreachJoin(scope: VisibilityScope): string {
  const tid = escUuid(scope.tenantId);
  let clause = `AND o.tenant_id = '${tid}'`;
  if (scope.mode === "team" && scope.workspaceIds && scope.workspaceIds.length > 0) {
    clause += ` AND (o.workspace_id IS NULL OR o.workspace_id IN (${escUuidList(scope.workspaceIds)}))`;
  }
  return clause;
}

/**
 * Clause SQL à appliquer dans le WHERE (après le JOIN).
 *
 * Pour les LEFT JOIN (mode discovery), la clause peut référencer `o.user_id IS NULL`.
 * Pour les INNER JOIN (mode mine/team/admin), `o` est toujours présent.
 *
 * @returns Une string commençant par "(" et finissant par ")" pour être combinable
 *          avec AND/OR dans la WHERE clause appelante. Jamais vide.
 */
export function buildOutreachWhere(scope: VisibilityScope): string {
  const uid = escUuid(scope.userId);

  switch (scope.mode) {
    case "discovery":
      // Sur /prospects : le LEFT JOIN peut retourner o.* = NULL si aucun outreach.
      // On veut : (jamais touché) OU (mes leads encore 'à contacter').
      return `(o.siren IS NULL OR (o.user_id = '${uid}' AND COALESCE(o.status, 'a_contacter') = 'a_contacter'))`;

    case "mine":
      // Mes outreach uniquement. INNER JOIN attendu côté query (o garanti).
      return `(o.user_id = '${uid}')`;

    case "team":
      // Tous les outreach du workspace. Le filtre workspace_id est déjà
      // dans le JOIN clause (buildOutreachJoin) — ici on n'ajoute rien.
      return "(TRUE)";

    case "admin":
      // Admin tenant avec flag explicite — voit tout. Le tenant_id est
      // dans le JOIN clause.
      return "(TRUE)";

    default: {
      const _exhaustive: never = scope.mode;
      throw new Error(`unknown visibility mode: ${_exhaustive}`);
    }
  }
}

/**
 * Détermine le mode de visibilité à partir du UserContext.
 *
 * @param page Hint sur la page courante — détermine "discovery" vs "mine".
 * @param adminOverride Si admin et passe ?showAll=1, bascule en "admin".
 */
export function resolveVisibilityMode(
  ctx: {
    isAdmin: boolean;
    workspaces: { id: string; visibilityScope: "all" | "own" }[];
    activeWorkspaceId: string | null;
  },
  page: "discovery" | "history-pipeline",
  adminOverride: boolean = false,
): VisibilityMode {
  // Page de découverte : TOUJOURS discovery, peu importe scope/admin.
  // Sauf si admin avec override explicite (pour debug/audit).
  if (page === "discovery") {
    return adminOverride && ctx.isAdmin ? "admin" : "discovery";
  }

  // Page historique/pipeline : dépend du scope du workspace actif.
  if (adminOverride && ctx.isAdmin) return "admin";

  const active =
    ctx.workspaces.find((w) => w.id === ctx.activeWorkspaceId) ??
    ctx.workspaces[0];
  if (!active) return "mine"; // fallback safe

  return active.visibilityScope === "all" ? "team" : "mine";
}
