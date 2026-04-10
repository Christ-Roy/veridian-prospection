/**
 * Workspace roles — Veridian SaaS standard.
 *
 * Identique dans toutes les apps Veridian. Calque sur Twenty.
 * Voir docs/saas-standards.md §3 pour la charte complète.
 */

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

/** Rank ordonné pour les comparaisons (owner = plus haut). */
export const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

/** Toutes les actions sensibles auxquelles un rôle peut avoir droit. */
export type WorkspaceAction =
  | "workspace.delete"
  | "workspace.transfer"
  | "workspace.update"
  | "member.invite"
  | "member.remove"
  | "member.change_role"
  | "billing.manage"
  | "resource.create"
  | "resource.update.own"
  | "resource.update.any"
  | "resource.delete.own"
  | "resource.delete.any"
  | "resource.read";

/**
 * Rôle minimum requis pour chaque action.
 * À modifier avec précaution — ce mapping est opposable dans toutes les apps.
 */
const MIN_ROLE: Record<WorkspaceAction, WorkspaceRole> = {
  "workspace.delete": "owner",
  "workspace.transfer": "owner",
  "billing.manage": "owner",
  "workspace.update": "admin",
  "member.invite": "admin",
  "member.remove": "admin",
  "member.change_role": "admin",
  "resource.update.any": "admin",
  "resource.delete.any": "admin",
  "resource.create": "member",
  "resource.update.own": "member",
  "resource.delete.own": "member",
  "resource.read": "viewer",
};

/**
 * Vérifie qu'un rôle peut effectuer une action.
 * Retourne `true` si le rank du rôle est >= au rank du rôle minimum requis.
 */
export function canPerform(role: WorkspaceRole, action: WorkspaceAction): boolean {
  const required = MIN_ROLE[action];
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/**
 * Type guard : vérifie qu'une string arbitraire est un WorkspaceRole valide.
 * Utile pour parser les rôles venus de la DB (où c'est stocké comme String).
 */
export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    typeof value === "string" &&
    (value === "owner" || value === "admin" || value === "member" || value === "viewer")
  );
}

/**
 * Normalise un rôle brut de la DB vers un WorkspaceRole.
 * Fallback `viewer` pour les valeurs inconnues (fail-safe : moins de droits).
 *
 * Tolère les valeurs legacy de Prospection :
 *   - `"admin"` / `"member"` existent déjà (inchangés)
 *   - Valeurs inconnues → `viewer`
 */
export function normalizeRole(raw: string | null | undefined): WorkspaceRole {
  if (raw === "owner" || raw === "admin" || raw === "member" || raw === "viewer") {
    return raw;
  }
  return "viewer";
}
