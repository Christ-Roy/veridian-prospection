/**
 * Tests de GET /api/prospects (liste prospects filtrée + quota freemium).
 *
 * Pattern fort : assert sur le BODY RETOURNÉ (shape exact, valeurs), pas
 * juste sur res.status (bug invitations 2026-05-23).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const {
  requireAuthMock,
  getTenantIdMock,
  getTenantProspectLimitMock,
  getWorkspaceScopeMock,
  getUserContextMock,
  cachedMock,
  isRateLimitedMock,
  queriesMock,
  getWorkspacePreferencesMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getTenantIdMock: vi.fn(),
  getTenantProspectLimitMock: vi.fn(),
  getWorkspaceScopeMock: vi.fn(),
  getUserContextMock: vi.fn(),
  cachedMock: vi.fn(
    async <T>(_k: string, _ttl: number, fn: () => Promise<T>) => fn(),
  ),
  isRateLimitedMock: vi.fn().mockReturnValue(false),
  queriesMock: {
    getProspects: vi.fn(),
    getDomainCounts: vi.fn(),
    getPresetCounts: vi.fn(),
    getAllSettings: vi.fn(),
  },
  getWorkspacePreferencesMock: vi.fn().mockResolvedValue({
    displayMode: "generic",
    defaultGeoFilters: null,
    defaultSectorFilters: null,
    onboardingCompletedAt: null,
  }),
}));

vi.mock("@/lib/auth/api-auth", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/auth/tenant", () => ({
  getTenantId: getTenantIdMock,
  getTenantProspectLimit: getTenantProspectLimitMock,
}));
vi.mock("@/lib/auth/user-context", () => ({
  getWorkspaceScope: getWorkspaceScopeMock,
  getUserContext: getUserContextMock,
}));
vi.mock("@/lib/cache", () => ({ cached: cachedMock }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: isRateLimitedMock }));
vi.mock("@/lib/queries", () => queriesMock);
vi.mock("@/lib/queries/workspace-preferences", () => ({
  getWorkspacePreferences: getWorkspacePreferencesMock,
}));

const { checkTrialExpiredMock } = vi.hoisted(() => ({
  checkTrialExpiredMock: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/trial", () => ({ checkTrialExpired: checkTrialExpiredMock }));

import { GET } from "@/app/api/prospects/route";
import { makeRequest, readJson } from "./_helpers";

function defaultAuthCtx() {
  requireAuthMock.mockResolvedValue({
    user: { id: "u-1", email: "u@v.site" },
  });
  getTenantIdMock.mockResolvedValue("t-1");
  getTenantProspectLimitMock.mockResolvedValue(100000); // pro plan
  getWorkspaceScopeMock.mockResolvedValue({
    ctx: { tenantId: "t-1" },
    filter: null,
    insertId: null,
  });
  getUserContextMock.mockResolvedValue({
    userId: "u-1",
    tenantId: "t-1",
    isAdmin: false,
    workspaces: [],
    activeWorkspaceId: null,
  });
  queriesMock.getAllSettings.mockResolvedValue({});
}

describe("GET /api/prospects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRateLimitedMock.mockReturnValue(false);
  });

  test("returns 401 when not authenticated", async () => {
    requireAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await GET(makeRequest("/api/prospects"));
    expect(res.status).toBe(401);
  });

  test("returns 429 when rate-limited", async () => {
    defaultAuthCtx();
    isRateLimitedMock.mockReturnValue(true);
    const res = await GET(makeRequest("/api/prospects"));
    expect(res.status).toBe(429);
    const body = (await readJson(res)) as { error: string };
    expect(body.error).toMatch(/Trop de requetes/);
  });

  test("returns prospects list — shape canonique {data, total} préservé", async () => {
    defaultAuthCtx();
    queriesMock.getProspects.mockResolvedValue({
      data: [
        { siren: "123456789", denomination: "ACME" },
        { siren: "987654321", denomination: "BETA" },
      ],
      total: 2,
    });

    const res = await GET(makeRequest("/api/prospects?limit=20"));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, unknown>;
    // Shape canonique : la route fait JSON.parse(JSON.stringify(payload))
    // donc on récupère exactement le shape de getProspects.
    expect(body).toEqual({
      data: [
        { siren: "123456789", denomination: "ACME" },
        { siren: "987654321", denomination: "BETA" },
      ],
      total: 2,
    });
    expect(queriesMock.getProspects).toHaveBeenCalled();
  });

  test("action=domain-counts retourne les counts au lieu d'une liste", async () => {
    defaultAuthCtx();
    queriesMock.getDomainCounts.mockResolvedValue({
      btp: 100,
      sante: 42,
    });

    const res = await GET(
      makeRequest("/api/prospects?action=domain-counts"),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, number>;
    expect(body).toEqual({ btp: 100, sante: 42 });
    expect(queriesMock.getProspects).not.toHaveBeenCalled();
  });

  test("action=preset-counts retourne les counts par preset", async () => {
    defaultAuthCtx();
    queriesMock.getPresetCounts.mockResolvedValue({
      top_prospects: 50,
      btp_artisans: 12,
    });

    const res = await GET(
      makeRequest("/api/prospects?action=preset-counts&domain=btp"),
    );
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Record<string, number>;
    expect(body).toEqual({ top_prospects: 50, btp_artisans: 12 });
  });

  // Anti-régression sabotage L291 (truncateSensitiveFields → return null).
  // En mode freemium + trial expiré, les champs sensibles doivent être
  // partiellement masqués (les 67 % de la fin remplacés par •).
  test("FREEMIUM TRIAL EXPIRÉ : champs sensibles obfusqués (anti-régression sabotage L291)", async () => {
    defaultAuthCtx();
    getTenantProspectLimitMock.mockResolvedValue(300); // freemium
    checkTrialExpiredMock.mockResolvedValue(true);
    // Inhibe la query freemium pool (sinon import dynamique cherche prisma).
    queriesMock.getAllSettings.mockResolvedValue({});
    queriesMock.getProspects.mockResolvedValue({
      data: [
        {
          siren: "111111111",
          domain: "acme.fr",
          nom_entreprise: "ACME COMPANY SA",
          email: "contact@acme.fr",
          phone: "+33612345678",
          dirigeant: "Jean Dupont",
          ville: "Paris",
        },
      ],
      total: 1,
    });

    const res = await GET(makeRequest("/api/prospects"));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      data: Array<Record<string, string>>;
    };
    const row = body.data[0];
    // Si truncateSensitiveFields est saboté (return null), data devient
    // [null] et row.siren crash → test rougit.
    expect(row.siren).toBe("111111111"); // siren NON obfusqué (non sensible)
    // Champs sensibles obfusqués : contiennent au moins un •
    expect(row.nom_entreprise).toMatch(/•/);
    expect(row.email).toMatch(/•/);
    expect(row.phone).toMatch(/•/);
    // Le préfixe (33 % conservé) doit être présent au début.
    expect(row.nom_entreprise.startsWith("ACME")).toBe(true);
  });

  test("BigInt depuis Prisma est sérialisé en Number dans le body JSON", async () => {
    defaultAuthCtx();
    queriesMock.getProspects.mockResolvedValue({
      data: [{ siren: "111111111", ca: BigInt(50000) }], // bigint Prisma
      total: 1,
    });

    const res = await GET(makeRequest("/api/prospects"));
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      data: Array<{ siren: string; ca: number }>;
    };
    // BigInt converti en Number — assertion forte sur le type ET la valeur.
    expect(body.data[0].ca).toBe(50000);
    expect(typeof body.data[0].ca).toBe("number");
  });

  // ── Mode agence (ticket switch-mode-agence) ─────────────────────────────
  // Le workspace pref displayMode='agency' doit injecter sort='tech_debt'
  // SI le client ne passe pas un sort explicite dans l'URL. C'est un défaut
  // serveur, pas un verrou — l'utilisateur garde la main via ?sort=.
  describe("displayMode workspace (mode agence)", () => {
    test("displayMode='agency' active sort='tech_debt' par défaut", async () => {
      defaultAuthCtx();
      getUserContextMock.mockResolvedValue({
        userId: "u-1",
        tenantId: "t-1",
        isAdmin: false,
        workspaces: [{ id: "ws-1" }],
        activeWorkspaceId: "ws-1",
      });
      getWorkspacePreferencesMock.mockResolvedValue({
        displayMode: "agency",
        defaultGeoFilters: null,
        defaultSectorFilters: null,
        onboardingCompletedAt: null,
      });
      queriesMock.getProspects.mockResolvedValue({ data: [], total: 0 });

      await GET(makeRequest("/api/prospects"));

      // getProspects appelé avec sort='tech_debt' (priorité défaut workspace)
      const call = queriesMock.getProspects.mock.calls[0][0];
      expect(call.sort).toBe("tech_debt");
    });

    test("displayMode='generic' ne force aucun sort par défaut", async () => {
      defaultAuthCtx();
      getUserContextMock.mockResolvedValue({
        userId: "u-1",
        tenantId: "t-1",
        isAdmin: false,
        workspaces: [{ id: "ws-1" }],
        activeWorkspaceId: "ws-1",
      });
      getWorkspacePreferencesMock.mockResolvedValue({
        displayMode: "generic",
        defaultGeoFilters: null,
        defaultSectorFilters: null,
        onboardingCompletedAt: null,
      });
      queriesMock.getProspects.mockResolvedValue({ data: [], total: 0 });

      await GET(makeRequest("/api/prospects"));

      const call = queriesMock.getProspects.mock.calls[0][0];
      // mode generic = sort undefined côté API → fallback côté query (prospect_score)
      expect(call.sort).toBeUndefined();
    });

    test("sort explicite ?sort=ca override le défaut agency", async () => {
      defaultAuthCtx();
      getUserContextMock.mockResolvedValue({
        userId: "u-1",
        tenantId: "t-1",
        isAdmin: false,
        workspaces: [{ id: "ws-1" }],
        activeWorkspaceId: "ws-1",
      });
      getWorkspacePreferencesMock.mockResolvedValue({
        displayMode: "agency",
        defaultGeoFilters: null,
        defaultSectorFilters: null,
        onboardingCompletedAt: null,
      });
      queriesMock.getProspects.mockResolvedValue({ data: [], total: 0 });

      await GET(
        makeRequest("/api/prospects", { searchParams: { sort: "ca" } }),
      );

      const call = queriesMock.getProspects.mock.calls[0][0];
      // Override utilisateur respecté — le mode agence n'est pas un verrou.
      expect(call.sort).toBe("ca");
    });

    test("erreur getWorkspacePreferences ne casse pas la route", async () => {
      defaultAuthCtx();
      getUserContextMock.mockResolvedValue({
        userId: "u-1",
        tenantId: "t-1",
        isAdmin: false,
        workspaces: [{ id: "ws-1" }],
        activeWorkspaceId: "ws-1",
      });
      getWorkspacePreferencesMock.mockRejectedValueOnce(new Error("DB down"));
      queriesMock.getProspects.mockResolvedValue({ data: [], total: 0 });

      const res = await GET(makeRequest("/api/prospects"));
      expect(res.status).toBe(200);
    });
  });
});
