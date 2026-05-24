// Workspace preferences — switch mode agence/générique + onboarding ciblage
// (ticket 2026-05-22-switch-mode-agence-et-onboarding.md).
//
// Persisté sur la table `workspaces` (colonnes display_mode,
// default_geo_filters, default_sector_filters, onboarding_completed_at) —
// migration 0019.
//
// Décision archi (Robert 2026-05-23) :
//   - Switch agence = TRI SEUL, pas de filtre.
//   - Onboarding = filtres par défaut MODIFIABLES, pas verrou.
//   - Persistence sur Workspace (pas Tenant) car Workspace porte déjà les
//     préférences user (leadsCredited, apiKeyHash, visibility_scope).

import { prisma } from "@/lib/prisma";

export type DisplayMode = "generic" | "agency";

export interface WorkspacePreferences {
  displayMode: DisplayMode;
  defaultGeoFilters: { departements?: string[] } | null;
  defaultSectorFilters: { secteurs?: string[] } | null;
  onboardingCompletedAt: Date | null;
}

/**
 * Récupère les préférences du workspace. Renvoie les défauts si workspace
 * inexistant ou colonnes NULL (cas onboarding pas fait).
 */
export async function getWorkspacePreferences(
  workspaceId: string,
): Promise<WorkspacePreferences> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      displayMode: true,
      defaultGeoFilters: true,
      defaultSectorFilters: true,
      onboardingCompletedAt: true,
    },
  });
  if (!ws) {
    return {
      displayMode: "generic",
      defaultGeoFilters: null,
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    };
  }
  return {
    displayMode: (ws.displayMode as DisplayMode) ?? "generic",
    defaultGeoFilters:
      ws.defaultGeoFilters as WorkspacePreferences["defaultGeoFilters"],
    defaultSectorFilters:
      ws.defaultSectorFilters as WorkspacePreferences["defaultSectorFilters"],
    onboardingCompletedAt: ws.onboardingCompletedAt,
  };
}

export interface WorkspacePreferencesPatch {
  displayMode?: DisplayMode;
  defaultGeoFilters?: { departements?: string[] } | null;
  defaultSectorFilters?: { secteurs?: string[] } | null;
  onboardingCompletedAt?: Date | null;
}

/**
 * Met à jour les préférences workspace. Patch partiel — seules les clés
 * définies sont écrites. Renvoie l'état post-update.
 */
export async function updateWorkspacePreferences(
  workspaceId: string,
  patch: WorkspacePreferencesPatch,
): Promise<WorkspacePreferences> {
  const data: Record<string, unknown> = {};
  if (patch.displayMode !== undefined) data.displayMode = patch.displayMode;
  if (patch.defaultGeoFilters !== undefined) {
    data.defaultGeoFilters = patch.defaultGeoFilters ?? null;
  }
  if (patch.defaultSectorFilters !== undefined) {
    data.defaultSectorFilters = patch.defaultSectorFilters ?? null;
  }
  if (patch.onboardingCompletedAt !== undefined) {
    data.onboardingCompletedAt = patch.onboardingCompletedAt;
  }

  const ws = await prisma.workspace.update({
    where: { id: workspaceId },
    data,
    select: {
      displayMode: true,
      defaultGeoFilters: true,
      defaultSectorFilters: true,
      onboardingCompletedAt: true,
    },
  });
  return {
    displayMode: (ws.displayMode as DisplayMode) ?? "generic",
    defaultGeoFilters:
      ws.defaultGeoFilters as WorkspacePreferences["defaultGeoFilters"],
    defaultSectorFilters:
      ws.defaultSectorFilters as WorkspacePreferences["defaultSectorFilters"],
    onboardingCompletedAt: ws.onboardingCompletedAt,
  };
}
