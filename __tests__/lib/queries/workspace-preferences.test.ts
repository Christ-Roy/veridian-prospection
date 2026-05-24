/**
 * Unit tests pour src/lib/queries/workspace-preferences.ts.
 *
 * Prisma mocké. Aucun appel DB réel.
 * Run: npx vitest run src/lib/queries/workspace-preferences.test.ts
 *
 * Couvre :
 *   - getWorkspacePreferences renvoie défauts si workspace inexistant
 *   - getWorkspacePreferences renvoie les colonnes Workspace
 *   - updateWorkspacePreferences écrit uniquement les clés du patch
 *   - updateWorkspacePreferences ne touche pas aux clés absentes du patch
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workspace: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

import {
  getWorkspacePreferences,
  updateWorkspacePreferences,
} from "@/lib/queries/workspace-preferences";

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
});

describe("getWorkspacePreferences", () => {
  it("renvoie les défauts si le workspace n'existe pas", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const prefs = await getWorkspacePreferences("ws-inexistant");
    expect(prefs).toEqual({
      displayMode: "generic",
      defaultGeoFilters: null,
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    });
  });

  it("renvoie les colonnes du workspace existant", async () => {
    const completed = new Date("2026-05-22T10:00:00Z");
    mockFindUnique.mockResolvedValueOnce({
      displayMode: "agency",
      defaultGeoFilters: { departements: ["69", "42"] },
      defaultSectorFilters: { secteurs: ["BTP"] },
      onboardingCompletedAt: completed,
    });
    const prefs = await getWorkspacePreferences("ws-1");
    expect(prefs.displayMode).toBe("agency");
    expect(prefs.defaultGeoFilters).toEqual({ departements: ["69", "42"] });
    expect(prefs.defaultSectorFilters).toEqual({ secteurs: ["BTP"] });
    expect(prefs.onboardingCompletedAt).toEqual(completed);
  });

  it("normalise displayMode null vers 'generic'", async () => {
    mockFindUnique.mockResolvedValueOnce({
      displayMode: null,
      defaultGeoFilters: null,
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    });
    const prefs = await getWorkspacePreferences("ws-vide");
    expect(prefs.displayMode).toBe("generic");
  });
});

describe("updateWorkspacePreferences", () => {
  it("n'envoie que les clés présentes dans le patch", async () => {
    mockUpdate.mockResolvedValueOnce({
      displayMode: "agency",
      defaultGeoFilters: null,
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    });
    await updateWorkspacePreferences("ws-1", { displayMode: "agency" });
    const callArg = mockUpdate.mock.calls[0][0];
    expect(callArg.where).toEqual({ id: "ws-1" });
    expect(callArg.data).toEqual({ displayMode: "agency" });
    // Les autres clés ne doivent PAS apparaître dans data
    expect(callArg.data).not.toHaveProperty("defaultGeoFilters");
    expect(callArg.data).not.toHaveProperty("defaultSectorFilters");
    expect(callArg.data).not.toHaveProperty("onboardingCompletedAt");
  });

  it("écrit defaultGeoFilters quand fourni", async () => {
    mockUpdate.mockResolvedValueOnce({
      displayMode: "generic",
      defaultGeoFilters: { departements: ["75"] },
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    });
    await updateWorkspacePreferences("ws-1", {
      defaultGeoFilters: { departements: ["75"] },
    });
    expect(mockUpdate.mock.calls[0][0].data).toEqual({
      defaultGeoFilters: { departements: ["75"] },
    });
  });

  it("normalise undefined defaultGeoFilters en absence (pas null)", async () => {
    mockUpdate.mockResolvedValueOnce({
      displayMode: "agency",
      defaultGeoFilters: null,
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    });
    await updateWorkspacePreferences("ws-1", {
      displayMode: "agency",
      // defaultGeoFilters undefined — ne doit PAS apparaître
    });
    expect(mockUpdate.mock.calls[0][0].data).toEqual({ displayMode: "agency" });
  });

  it("permet d'effacer un filtre par défaut (null explicite)", async () => {
    mockUpdate.mockResolvedValueOnce({
      displayMode: "generic",
      defaultGeoFilters: null,
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    });
    await updateWorkspacePreferences("ws-1", { defaultGeoFilters: null });
    expect(mockUpdate.mock.calls[0][0].data).toEqual({
      defaultGeoFilters: null,
    });
  });

  it("renvoie l'état post-update", async () => {
    const completed = new Date();
    mockUpdate.mockResolvedValueOnce({
      displayMode: "agency",
      defaultGeoFilters: { departements: ["69"] },
      defaultSectorFilters: { secteurs: ["BTP"] },
      onboardingCompletedAt: completed,
    });
    const prefs = await updateWorkspacePreferences("ws-1", {
      displayMode: "agency",
      onboardingCompletedAt: completed,
    });
    expect(prefs.displayMode).toBe("agency");
    expect(prefs.onboardingCompletedAt).toEqual(completed);
  });
});
