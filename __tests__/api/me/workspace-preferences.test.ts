/**
 * Tests de la route /api/me/workspace-preferences (GET, PATCH).
 *
 * Couvre :
 *   - 401 si non authentifié
 *   - 404 si user n'a pas de workspace
 *   - GET renvoie les prefs du workspace actif
 *   - PATCH valide les types stricts (displayMode, geo, sector, onboarding)
 *   - PATCH rejette displayMode invalide (anti SQL injection / XSS)
 *   - PATCH écrit `onboardingCompletedAt = new Date()` quand `true` envoyé
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getUserContextMock,
  getWorkspacePreferencesMock,
  updateWorkspacePreferencesMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getUserContextMock: vi.fn(),
  getWorkspacePreferencesMock: vi.fn(),
  updateWorkspacePreferencesMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/user-context", () => ({
  getUserContext: getUserContextMock,
}));
vi.mock("@/lib/queries/workspace-preferences", () => ({
  getWorkspacePreferences: getWorkspacePreferencesMock,
  updateWorkspacePreferences: updateWorkspacePreferencesMock,
}));

import { GET, PATCH } from "@/app/api/me/workspace-preferences/route";
import { makeRequest, makeUserContext } from "../_helpers";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/me/workspace-preferences GET", () => {
  test("401 quand non authentifié", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("401 quand getUserContext renvoie null", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getUserContextMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("404 quand pas de workspace", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getUserContextMock.mockResolvedValue(
      makeUserContext({ workspaces: [], activeWorkspaceId: null }),
    );
    const res = await GET();
    expect(res.status).toBe(404);
  });

  test("renvoie les prefs du workspace actif", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getUserContextMock.mockResolvedValue(
      makeUserContext({ activeWorkspaceId: "ws-1" }),
    );
    getWorkspacePreferencesMock.mockResolvedValue({
      displayMode: "agency",
      defaultGeoFilters: { departements: ["69"] },
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.displayMode).toBe("agency");
    expect(data.defaultGeoFilters).toEqual({ departements: ["69"] });
    expect(getWorkspacePreferencesMock).toHaveBeenCalledWith("ws-1");
  });

  test("fallback sur workspaces[0] si pas d'activeWorkspaceId", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getUserContextMock.mockResolvedValue(
      makeUserContext({ activeWorkspaceId: null }),
    );
    getWorkspacePreferencesMock.mockResolvedValue({
      displayMode: "generic",
      defaultGeoFilters: null,
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(getWorkspacePreferencesMock).toHaveBeenCalledWith("ws-test-1");
  });
});

describe("/api/me/workspace-preferences PATCH", () => {
  function authedRequest(body: unknown) {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "u@v.site" },
    });
    getUserContextMock.mockResolvedValue(
      makeUserContext({ activeWorkspaceId: "ws-1" }),
    );
    return makeRequest("/api/me/workspace-preferences", {
      method: "PATCH",
      body,
    });
  }

  test("401 quand non authentifié", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const req = makeRequest("/api/me/workspace-preferences", {
      method: "PATCH",
      body: {},
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  test("400 quand displayMode invalide", async () => {
    const res = await PATCH(authedRequest({ displayMode: "haxxor" }));
    expect(res.status).toBe(400);
    expect(updateWorkspacePreferencesMock).not.toHaveBeenCalled();
  });

  test("400 quand displayMode pas une string", async () => {
    const res = await PATCH(authedRequest({ displayMode: 42 }));
    expect(res.status).toBe(400);
  });

  test("400 quand body vide après filtrage", async () => {
    const res = await PATCH(authedRequest({}));
    expect(res.status).toBe(400);
    expect(updateWorkspacePreferencesMock).not.toHaveBeenCalled();
  });

  test("accepte displayMode='agency'", async () => {
    updateWorkspacePreferencesMock.mockResolvedValue({
      displayMode: "agency",
      defaultGeoFilters: null,
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    });
    const res = await PATCH(authedRequest({ displayMode: "agency" }));
    expect(res.status).toBe(200);
    expect(updateWorkspacePreferencesMock).toHaveBeenCalledWith("ws-1", {
      displayMode: "agency",
    });
  });

  test("accepte defaultGeoFilters avec departements", async () => {
    updateWorkspacePreferencesMock.mockResolvedValue({
      displayMode: "generic",
      defaultGeoFilters: { departements: ["69", "42"] },
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    });
    const res = await PATCH(
      authedRequest({ defaultGeoFilters: { departements: ["69", "42"] } }),
    );
    expect(res.status).toBe(200);
    expect(updateWorkspacePreferencesMock).toHaveBeenCalledWith("ws-1", {
      defaultGeoFilters: { departements: ["69", "42"] },
    });
  });

  test("400 quand defaultGeoFilters.departements pas un string[]", async () => {
    const res = await PATCH(
      authedRequest({ defaultGeoFilters: { departements: [69, 42] } }),
    );
    expect(res.status).toBe(400);
  });

  test("400 quand defaultGeoFilters n'est ni objet ni null", async () => {
    const res = await PATCH(
      authedRequest({ defaultGeoFilters: "69,42" }),
    );
    expect(res.status).toBe(400);
  });

  test("accepte defaultSectorFilters null (efface)", async () => {
    updateWorkspacePreferencesMock.mockResolvedValue({
      displayMode: "generic",
      defaultGeoFilters: null,
      defaultSectorFilters: null,
      onboardingCompletedAt: null,
    });
    const res = await PATCH(authedRequest({ defaultSectorFilters: null }));
    expect(res.status).toBe(200);
    expect(updateWorkspacePreferencesMock).toHaveBeenCalledWith("ws-1", {
      defaultSectorFilters: null,
    });
  });

  test("convertit onboardingCompletedAt=true en Date now", async () => {
    updateWorkspacePreferencesMock.mockResolvedValue({
      displayMode: "generic",
      defaultGeoFilters: null,
      defaultSectorFilters: null,
      onboardingCompletedAt: new Date(),
    });
    const before = Date.now();
    const res = await PATCH(
      authedRequest({ onboardingCompletedAt: true }),
    );
    const after = Date.now();
    expect(res.status).toBe(200);
    const call = updateWorkspacePreferencesMock.mock.calls[0][1];
    expect(call.onboardingCompletedAt).toBeInstanceOf(Date);
    const ts = (call.onboardingCompletedAt as Date).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("accepte onboardingCompletedAt en ISO string", async () => {
    updateWorkspacePreferencesMock.mockResolvedValue({
      displayMode: "generic",
      defaultGeoFilters: null,
      defaultSectorFilters: null,
      onboardingCompletedAt: new Date("2026-05-22T10:00:00Z"),
    });
    const res = await PATCH(
      authedRequest({
        onboardingCompletedAt: "2026-05-22T10:00:00Z",
      }),
    );
    expect(res.status).toBe(200);
  });

  test("400 onboardingCompletedAt date invalide", async () => {
    const res = await PATCH(
      authedRequest({ onboardingCompletedAt: "pas-une-date" }),
    );
    expect(res.status).toBe(400);
  });

  test("400 onboardingCompletedAt type non supporté", async () => {
    const res = await PATCH(authedRequest({ onboardingCompletedAt: 42 }));
    expect(res.status).toBe(400);
  });

  test("accepte patch multi-clé en une seule call", async () => {
    updateWorkspacePreferencesMock.mockResolvedValue({
      displayMode: "agency",
      defaultGeoFilters: { departements: ["75"] },
      defaultSectorFilters: { secteurs: ["BTP"] },
      onboardingCompletedAt: new Date(),
    });
    const res = await PATCH(
      authedRequest({
        displayMode: "agency",
        defaultGeoFilters: { departements: ["75"] },
        defaultSectorFilters: { secteurs: ["BTP"] },
        onboardingCompletedAt: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(updateWorkspacePreferencesMock).toHaveBeenCalledTimes(1);
    const call = updateWorkspacePreferencesMock.mock.calls[0][1];
    expect(call.displayMode).toBe("agency");
    expect(call.defaultGeoFilters).toEqual({ departements: ["75"] });
    expect(call.defaultSectorFilters).toEqual({ secteurs: ["BTP"] });
    expect(call.onboardingCompletedAt).toBeInstanceOf(Date);
  });
});
