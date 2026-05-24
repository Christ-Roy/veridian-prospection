// GET / PATCH /api/me/workspace-preferences
//
// Préférences UX du workspace actif :
//   - displayMode ("generic" | "agency") — switch mode agence (tri seul)
//   - defaultGeoFilters / defaultSectorFilters — choix de l'onboarding,
//     pré-remplissent les sidebars (modifiables, pas verrou)
//   - onboardingCompletedAt — flag "onboarding fait"
//
// Voir ticket todo/2026-05-22-switch-mode-agence-et-onboarding.md.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { getUserContext } from "@/lib/auth/user-context";
import {
  getWorkspacePreferences,
  updateWorkspacePreferences,
} from "@/lib/queries/workspace-preferences";

// Modes valides — TS narrowing pour le payload PATCH.
const DISPLAY_MODES = new Set(["generic", "agency"] as const);
type DisplayMode = "generic" | "agency";

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const ctx = await getUserContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const wsId = ctx.activeWorkspaceId ?? ctx.workspaces[0]?.id;
  if (!wsId) {
    return NextResponse.json(
      { error: "No workspace for user" },
      { status: 404 },
    );
  }

  const prefs = await getWorkspacePreferences(wsId);
  return NextResponse.json(prefs);
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const ctx = await getUserContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const wsId = ctx.activeWorkspaceId ?? ctx.workspaces[0]?.id;
  if (!wsId) {
    return NextResponse.json(
      { error: "No workspace for user" },
      { status: 404 },
    );
  }

  // Pattern Veridian classique — body unwrap permissif (cf
  // project_route_safe_parse_pattern).
  const body = (await request
    .json()
    .catch(() => ({}))) as Record<string, unknown>;

  // Validation stricte — on n'écrit que des clés connues, on rejette
  // explicitement les types invalides plutôt que de "essayer" en DB.
  const patch: {
    displayMode?: DisplayMode;
    defaultGeoFilters?: { departements?: string[] } | null;
    defaultSectorFilters?: { secteurs?: string[] } | null;
    onboardingCompletedAt?: Date | null;
  } = {};

  if (body.displayMode !== undefined) {
    if (
      typeof body.displayMode !== "string" ||
      !DISPLAY_MODES.has(body.displayMode as DisplayMode)
    ) {
      return NextResponse.json(
        { error: "displayMode must be 'generic' or 'agency'" },
        { status: 400 },
      );
    }
    patch.displayMode = body.displayMode as DisplayMode;
  }

  if (body.defaultGeoFilters !== undefined) {
    if (body.defaultGeoFilters === null) {
      patch.defaultGeoFilters = null;
    } else if (
      typeof body.defaultGeoFilters === "object" &&
      body.defaultGeoFilters !== null
    ) {
      const departements = (
        body.defaultGeoFilters as { departements?: unknown }
      ).departements;
      if (departements !== undefined && !isStringArray(departements)) {
        return NextResponse.json(
          { error: "defaultGeoFilters.departements must be string[]" },
          { status: 400 },
        );
      }
      patch.defaultGeoFilters = { departements: departements as string[] };
    } else {
      return NextResponse.json(
        { error: "defaultGeoFilters must be an object or null" },
        { status: 400 },
      );
    }
  }

  if (body.defaultSectorFilters !== undefined) {
    if (body.defaultSectorFilters === null) {
      patch.defaultSectorFilters = null;
    } else if (
      typeof body.defaultSectorFilters === "object" &&
      body.defaultSectorFilters !== null
    ) {
      const secteurs = (body.defaultSectorFilters as { secteurs?: unknown })
        .secteurs;
      if (secteurs !== undefined && !isStringArray(secteurs)) {
        return NextResponse.json(
          { error: "defaultSectorFilters.secteurs must be string[]" },
          { status: 400 },
        );
      }
      patch.defaultSectorFilters = { secteurs: secteurs as string[] };
    } else {
      return NextResponse.json(
        { error: "defaultSectorFilters must be an object or null" },
        { status: 400 },
      );
    }
  }

  if (body.onboardingCompletedAt !== undefined) {
    if (body.onboardingCompletedAt === null) {
      patch.onboardingCompletedAt = null;
    } else if (body.onboardingCompletedAt === true) {
      // Convention front : `true` = "marque comme fait maintenant".
      patch.onboardingCompletedAt = new Date();
    } else if (typeof body.onboardingCompletedAt === "string") {
      const d = new Date(body.onboardingCompletedAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "onboardingCompletedAt must be a valid date" },
          { status: 400 },
        );
      }
      patch.onboardingCompletedAt = d;
    } else {
      return NextResponse.json(
        { error: "onboardingCompletedAt must be ISO string, true, or null" },
        { status: 400 },
      );
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  const prefs = await updateWorkspacePreferences(wsId, patch);
  return NextResponse.json(prefs);
}
