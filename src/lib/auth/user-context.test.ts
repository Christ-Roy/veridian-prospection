/**
 * Tests unitaires pour src/lib/auth/user-context.ts
 *
 * Module de RÉSOLUTION MULTI-TENANT — entrée de TOUS les hot paths Prospection.
 * Toute régression silencieuse ici = soit fuite de données cross-tenant
 * (catastrophique), soit anti-DoS (surcharge DB par perte du cache).
 *
 * Contrat protégé :
 *   - Si pas de session → null (pas de throw, pas de leak)
 *   - Owner direct du tenant → ctx avec isAdmin=true
 *   - Membre invité (pas owner) → résolution via workspace_members → ctx valide
 *   - Si aucun tenant trouvé → null + console.warn (orphelin)
 *   - Workspaces filtrés au tenant courant (interdiction cross-tenant)
 *   - admin = owner du tenant OU membre avec role admin/owner
 *   - activeWorkspaceId : cookie si valide, sinon premier workspace
 *   - Cache 30s : 2 appels successifs = 1 seul query Prisma
 *   - invalidateUserContext / invalidateAllUserContexts vident le cache
 *   - getWorkspaceFilter / getUserFilter : admin = null (pas de filtre),
 *     scope "own" = userId, scope "all" = null
 *   - requireUser / requireAdmin : 401 / 403 propres
 *
 * Run: npx vitest run src/lib/auth/user-context.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  mockAuth,
  mockCookies,
  mockTenantFindFirst,
  mockTenantFindUnique,
  mockWorkspaceMemberFindFirst,
  mockWorkspaceMemberFindMany,
  mockWorkspaceFindFirst,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCookies: vi.fn(),
  mockTenantFindFirst: vi.fn(),
  mockTenantFindUnique: vi.fn(),
  mockWorkspaceMemberFindFirst: vi.fn(),
  mockWorkspaceMemberFindMany: vi.fn(),
  mockWorkspaceFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/headers", () => ({ cookies: mockCookies }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: {
      findFirst: mockTenantFindFirst,
      findUnique: mockTenantFindUnique,
    },
    workspaceMember: {
      findFirst: mockWorkspaceMemberFindFirst,
      findMany: mockWorkspaceMemberFindMany,
    },
    workspace: {
      findFirst: mockWorkspaceFindFirst,
    },
  },
}));

import {
  getUserContext,
  getUserFilter,
  getWorkspaceFilter,
  getWorkspaceScope,
  invalidateAllUserContexts,
  invalidateUserContext,
  requireAdmin,
  requireUser,
  resolveInsertWorkspaceId,
  type UserContext,
  type WorkspaceMembership,
} from "./user-context";

// Cookie store helper — la vraie API renvoie un objet avec `.get(name)` qui
// retourne `{value: string} | undefined`. On reflète ce contrat.
function makeCookieStore(activeWorkspaceId: string | null = null) {
  return {
    get: (name: string) => {
      if (name === "active_workspace_id" && activeWorkspaceId) {
        return { value: activeWorkspaceId };
      }
      return undefined;
    },
  };
}

beforeEach(() => {
  mockAuth.mockReset();
  mockCookies.mockReset();
  mockTenantFindFirst.mockReset();
  mockTenantFindUnique.mockReset();
  mockWorkspaceMemberFindFirst.mockReset();
  mockWorkspaceMemberFindMany.mockReset();
  mockWorkspaceFindFirst.mockReset();
  invalidateAllUserContexts();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Cookies par défaut = pas de active_workspace_id
  mockCookies.mockResolvedValue(makeCookieStore(null));
});

// ──────────────────────────────────────────────────────────────────────────
//  getUserContext — pas de session
// ──────────────────────────────────────────────────────────────────────────
describe("getUserContext — pas de session", () => {
  it("retourne null si auth() renvoie null", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await getUserContext()).toBeNull();
    // Pas de query DB en l'absence de session — c'est le contrat anti-DoS.
    expect(mockTenantFindFirst).not.toHaveBeenCalled();
  });

  it("retourne null si session sans id ou sans email", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: null, email: null } });
    expect(await getUserContext()).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  getUserContext — owner direct (tenant.userId === user.id)
// ──────────────────────────────────────────────────────────────────────────
describe("getUserContext — owner direct du tenant", () => {
  it("résout le tenant direct et marque isAdmin=true", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", email: "owner@veridian.site" },
    });
    mockTenantFindFirst.mockResolvedValueOnce({
      id: "tenant-1",
      userId: "user-1",
    });
    mockWorkspaceMemberFindMany.mockResolvedValueOnce([]);

    const ctx = await getUserContext();

    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe("user-1");
    expect(ctx!.email).toBe("owner@veridian.site");
    expect(ctx!.tenantId).toBe("tenant-1");
    expect(ctx!.tenantOwnerId).toBe("user-1");
    expect(ctx!.isAdmin).toBe(true); // owner → admin garanti
    expect(ctx!.workspaces).toEqual([]);
    expect(ctx!.activeWorkspaceId).toBeNull();

    // Le fallback membre NE DOIT PAS être appelé quand owner direct trouvé.
    expect(mockWorkspaceMemberFindFirst).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  getUserContext — membre invité (fallback via workspace_members)
// ──────────────────────────────────────────────────────────────────────────
describe("getUserContext — membre invité (non-owner)", () => {
  it("résout le tenant via membership quand pas owner direct", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-invitee", email: "guest@veridian.site" },
    });
    // Pas de tenant direct
    mockTenantFindFirst.mockResolvedValueOnce(null);
    // Mais membre d'un workspace
    mockWorkspaceMemberFindFirst.mockResolvedValueOnce({
      workspaceId: "ws-A",
      role: "member",
      workspace: { tenantId: "tenant-host", id: "ws-A" },
    });
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "tenant-host",
      userId: "user-host", // != user-invitee
    });
    mockWorkspaceMemberFindMany.mockResolvedValueOnce([
      {
        workspaceId: "ws-A",
        role: "member",
        visibilityScope: "all",
        workspace: {
          tenantId: "tenant-host",
          id: "ws-A",
          name: "Host Team",
          slug: "host-team",
        },
      },
    ]);

    const ctx = await getUserContext();

    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe("tenant-host");
    expect(ctx!.tenantOwnerId).toBe("user-host");
    expect(ctx!.isAdmin).toBe(false); // pas owner, pas admin membership
    expect(ctx!.workspaces).toHaveLength(1);
    expect(ctx!.workspaces[0].id).toBe("ws-A");
  });

  it("retourne null si user orphelin (pas owner, pas membre)", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-orph", email: "orph@veridian.site" },
    });
    mockTenantFindFirst.mockResolvedValueOnce(null);
    mockWorkspaceMemberFindFirst.mockResolvedValueOnce(null);

    expect(await getUserContext()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("No tenant for user user-orph"),
    );
  });

  it("ISOLATION CROSS-TENANT : filtre les workspaces au tenant courant", async () => {
    // user-multi est membre de 2 workspaces dans 2 tenants différents — on
    // doit voir UNIQUEMENT ceux du tenant résolu (sinon = data leak).
    mockAuth.mockResolvedValue({
      user: { id: "user-multi", email: "multi@v.site" },
    });
    mockTenantFindFirst.mockResolvedValueOnce({
      id: "tenant-correct",
      userId: "user-multi",
    });
    mockWorkspaceMemberFindMany.mockResolvedValueOnce([
      {
        workspaceId: "ws-correct",
        role: "owner",
        visibilityScope: "all",
        workspace: { tenantId: "tenant-correct", id: "ws-correct", name: "Mine", slug: "mine" },
      },
      {
        workspaceId: "ws-other-tenant",
        role: "admin",
        visibilityScope: "all",
        workspace: {
          tenantId: "tenant-other",
          id: "ws-other-tenant",
          name: "Other",
          slug: "other",
        },
      },
    ]);

    const ctx = await getUserContext();

    expect(ctx!.workspaces).toHaveLength(1);
    expect(ctx!.workspaces[0].id).toBe("ws-correct");
    expect(
      ctx!.workspaces.find((w) => w.id === "ws-other-tenant"),
    ).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  isAdmin — owner OU membre avec role admin/owner
// ──────────────────────────────────────────────────────────────────────────
describe("getUserContext — calcul isAdmin", () => {
  function setupMember(role: "admin" | "owner" | "member" | "viewer") {
    mockAuth.mockResolvedValue({
      user: { id: "user-m", email: "m@v.site" },
    });
    mockTenantFindFirst.mockResolvedValueOnce(null);
    mockWorkspaceMemberFindFirst.mockResolvedValueOnce({
      workspace: { tenantId: "tenant-host" },
    });
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "tenant-host",
      userId: "user-host-not-me",
    });
    mockWorkspaceMemberFindMany.mockResolvedValueOnce([
      {
        workspaceId: "ws-X",
        role,
        visibilityScope: "all",
        workspace: { tenantId: "tenant-host", id: "ws-X", name: "Team", slug: "team" },
      },
    ]);
  }

  it.each(["admin", "owner"] as const)(
    "isAdmin=true si role membership = %s",
    async (role) => {
      setupMember(role);
      const ctx = await getUserContext();
      expect(ctx!.isAdmin).toBe(true);
    },
  );

  it.each(["member", "viewer"] as const)(
    "isAdmin=false si role membership = %s (et pas owner du tenant)",
    async (role) => {
      setupMember(role);
      const ctx = await getUserContext();
      expect(ctx!.isAdmin).toBe(false);
    },
  );
});

// ──────────────────────────────────────────────────────────────────────────
//  activeWorkspaceId : cookie respecté SEULEMENT si valide pour ce user
// ──────────────────────────────────────────────────────────────────────────
describe("getUserContext — activeWorkspaceId via cookie", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", email: "u@v.site" },
    });
    mockTenantFindFirst.mockResolvedValueOnce({
      id: "tenant-1",
      userId: "user-1",
    });
    mockWorkspaceMemberFindMany.mockResolvedValueOnce([
      {
        workspaceId: "ws-A",
        role: "owner",
        visibilityScope: "all",
        workspace: { tenantId: "tenant-1", id: "ws-A", name: "A", slug: "a" },
      },
      {
        workspaceId: "ws-B",
        role: "member",
        visibilityScope: "all",
        workspace: { tenantId: "tenant-1", id: "ws-B", name: "B", slug: "b" },
      },
    ]);
  });

  it("prend le cookie quand il pointe sur un workspace valide", async () => {
    mockCookies.mockResolvedValue(makeCookieStore("ws-B"));
    const ctx = await getUserContext();
    expect(ctx!.activeWorkspaceId).toBe("ws-B");
  });

  it("retombe sur le 1er workspace si cookie pointe vers un workspace inconnu (anti-spoof)", async () => {
    mockCookies.mockResolvedValue(makeCookieStore("ws-EVIL-not-mine"));
    const ctx = await getUserContext();
    expect(ctx!.activeWorkspaceId).toBe("ws-A");
  });

  it("retombe sur le 1er workspace si pas de cookie", async () => {
    mockCookies.mockResolvedValue(makeCookieStore(null));
    const ctx = await getUserContext();
    expect(ctx!.activeWorkspaceId).toBe("ws-A");
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  Cache 30s
// ──────────────────────────────────────────────────────────────────────────
describe("getUserContext — cache 30s anti-DoS", () => {
  it("ne fait qu'UN appel Prisma sur 2 invocations consécutives", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-cache", email: "c@v.site" },
    });
    mockTenantFindFirst.mockResolvedValueOnce({
      id: "tenant-cache",
      userId: "user-cache",
    });
    mockWorkspaceMemberFindMany.mockResolvedValueOnce([
      {
        workspaceId: "ws-1",
        role: "owner",
        visibilityScope: "all",
        workspace: { tenantId: "tenant-cache", id: "ws-1", name: "W1", slug: "w1" },
      },
    ]);

    const c1 = await getUserContext();
    const c2 = await getUserContext();

    expect(c1!.tenantId).toBe("tenant-cache");
    expect(c2!.tenantId).toBe("tenant-cache");
    expect(mockTenantFindFirst).toHaveBeenCalledTimes(1);
    expect(mockWorkspaceMemberFindMany).toHaveBeenCalledTimes(1);
  });

  it("invalidateUserContext force un re-fetch au prochain appel", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-inv", email: "i@v.site" },
    });
    mockTenantFindFirst
      .mockResolvedValueOnce({ id: "tenant-1", userId: "user-inv" })
      .mockResolvedValueOnce({ id: "tenant-1", userId: "user-inv" });
    mockWorkspaceMemberFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await getUserContext();
    invalidateUserContext("user-inv");
    await getUserContext();

    expect(mockTenantFindFirst).toHaveBeenCalledTimes(2);
  });

  it("invalidateAllUserContexts vide tout le cache (utile sur swap tenant global)", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-all", email: "a@v.site" },
    });
    mockTenantFindFirst
      .mockResolvedValueOnce({ id: "t1", userId: "user-all" })
      .mockResolvedValueOnce({ id: "t1", userId: "user-all" });
    mockWorkspaceMemberFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await getUserContext();
    invalidateAllUserContexts();
    await getUserContext();

    expect(mockTenantFindFirst).toHaveBeenCalledTimes(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  requireUser / requireAdmin
// ──────────────────────────────────────────────────────────────────────────
describe("requireUser / requireAdmin — gates HTTP", () => {
  it("requireUser renvoie 401 si pas de ctx", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const r = await requireUser();
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error.status).toBe(401);
    }
  });

  it("requireUser renvoie {ctx} si user authentifié", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", email: "u@v.site" },
    });
    mockTenantFindFirst.mockResolvedValueOnce({
      id: "tenant-1",
      userId: "user-1",
    });
    mockWorkspaceMemberFindMany.mockResolvedValueOnce([]);

    const r = await requireUser();
    expect("ctx" in r).toBe(true);
    if ("ctx" in r) {
      expect(r.ctx.userId).toBe("user-1");
    }
  });

  it("requireAdmin renvoie 403 si user authentifié MAIS pas admin", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-m", email: "m@v.site" },
    });
    mockTenantFindFirst.mockResolvedValueOnce(null);
    mockWorkspaceMemberFindFirst.mockResolvedValueOnce({
      workspace: { tenantId: "tenant-host" },
    });
    mockTenantFindUnique.mockResolvedValueOnce({
      id: "tenant-host",
      userId: "user-host",
    });
    mockWorkspaceMemberFindMany.mockResolvedValueOnce([
      {
        workspaceId: "ws-X",
        role: "member",
        visibilityScope: "all",
        workspace: { tenantId: "tenant-host", id: "ws-X", name: "X", slug: "x" },
      },
    ]);

    const r = await requireAdmin();
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error.status).toBe(403);
    }
  });

  it("requireAdmin renvoie {ctx} pour un owner", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", email: "owner@v.site" },
    });
    mockTenantFindFirst.mockResolvedValueOnce({
      id: "t-1",
      userId: "user-1",
    });
    mockWorkspaceMemberFindMany.mockResolvedValueOnce([]);

    const r = await requireAdmin();
    expect("ctx" in r).toBe(true);
  });

  it("requireAdmin renvoie 401 (PAS 403) si pas authentifié du tout", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const r = await requireAdmin();
    expect("error" in r).toBe(true);
    if ("error" in r) {
      // Important : 401 propage l'absence d'auth, pas un 403 trompeur
      // (qui ferait croire au client que sa session est valide).
      expect(r.error.status).toBe(401);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  Filters (getWorkspaceFilter / getUserFilter / getWorkspaceScope)
// ──────────────────────────────────────────────────────────────────────────
describe("getWorkspaceFilter — verrouillage cross-tenant DB", () => {
  const baseCtx = (
    overrides: Partial<UserContext> & { workspaces?: WorkspaceMembership[] } = {},
  ): UserContext => ({
    userId: "u-1",
    email: "u@v.site",
    tenantId: "t-1",
    tenantOwnerId: "u-1",
    workspaces: [],
    isAdmin: false,
    activeWorkspaceId: null,
    ...overrides,
  });

  it("admin → null (pas de filtre, voit tout son tenant)", () => {
    expect(getWorkspaceFilter(baseCtx({ isAdmin: true }))).toBeNull();
  });

  it("member non-admin → liste de ses workspace ids", () => {
    const filter = getWorkspaceFilter(
      baseCtx({
        workspaces: [
          { id: "ws-A", name: "A", slug: "a", role: "member", visibilityScope: "all" },
          { id: "ws-B", name: "B", slug: "b", role: "member", visibilityScope: "all" },
        ],
      }),
    );
    expect(filter).toEqual(["ws-A", "ws-B"]);
  });

  it("member sans workspace → liste vide (DB query renverra [])", () => {
    expect(getWorkspaceFilter(baseCtx())).toEqual([]);
  });
});

describe("getUserFilter — scope 'own' (visibilité limitée à ses propres rows)", () => {
  const ctxWith = (scope: "all" | "own", isAdmin = false): UserContext => ({
    userId: "u-1",
    email: "u@v.site",
    tenantId: "t-1",
    tenantOwnerId: "u-1",
    workspaces: [{ id: "ws-A", name: "A", slug: "a", role: "member", visibilityScope: scope }],
    isAdmin,
    activeWorkspaceId: "ws-A",
  });

  it("scope 'own' → renvoie userId (le caller doit filtrer DB par owner)", () => {
    expect(getUserFilter(ctxWith("own"))).toBe("u-1");
  });

  it("scope 'all' → null (pas de restriction utilisateur)", () => {
    expect(getUserFilter(ctxWith("all"))).toBeNull();
  });

  it("isAdmin → null peu importe le scope (admin > scope)", () => {
    expect(getUserFilter(ctxWith("own", true))).toBeNull();
  });

  it("aucun workspace → null (pas de scope applicable)", () => {
    expect(
      getUserFilter({
        userId: "u-1",
        email: "u@v.site",
        tenantId: "t-1",
        tenantOwnerId: "u-1",
        workspaces: [],
        isAdmin: false,
        activeWorkspaceId: null,
      }),
    ).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  resolveInsertWorkspaceId
// ──────────────────────────────────────────────────────────────────────────
describe("resolveInsertWorkspaceId — où insérer une row nouvellement créée", () => {
  it("préfère activeWorkspaceId s'il existe", async () => {
    const ctx: UserContext = {
      userId: "u-1",
      email: "u@v.site",
      tenantId: "t-1",
      tenantOwnerId: "u-1",
      workspaces: [
        { id: "ws-A", name: "A", slug: "a", role: "owner", visibilityScope: "all" },
      ],
      isAdmin: true,
      activeWorkspaceId: "ws-A",
    };
    expect(await resolveInsertWorkspaceId(ctx)).toBe("ws-A");
    expect(mockWorkspaceFindFirst).not.toHaveBeenCalled();
  });

  it("fallback sur le 1er workspace si pas d'active", async () => {
    const ctx: UserContext = {
      userId: "u-1",
      email: "u@v.site",
      tenantId: "t-1",
      tenantOwnerId: "u-1",
      workspaces: [
        { id: "ws-A", name: "A", slug: "a", role: "owner", visibilityScope: "all" },
      ],
      isAdmin: true,
      activeWorkspaceId: null,
    };
    expect(await resolveInsertWorkspaceId(ctx)).toBe("ws-A");
  });

  it("dernier recours : lookup workspace 'default' du tenant", async () => {
    mockWorkspaceFindFirst.mockResolvedValueOnce({ id: "ws-default" });
    const ctx: UserContext = {
      userId: "u-1",
      email: "u@v.site",
      tenantId: "t-1",
      tenantOwnerId: "u-1",
      workspaces: [],
      isAdmin: true,
      activeWorkspaceId: null,
    };
    expect(await resolveInsertWorkspaceId(ctx)).toBe("ws-default");
    expect(mockWorkspaceFindFirst).toHaveBeenCalledWith({
      where: { tenantId: "t-1", slug: "default" },
      select: { id: true },
    });
  });

  it("null si vraiment rien de résolu (et catch silent si Prisma throw)", async () => {
    mockWorkspaceFindFirst.mockRejectedValueOnce(new Error("DB down"));
    const ctx: UserContext = {
      userId: "u-1",
      email: "u@v.site",
      tenantId: "t-1",
      tenantOwnerId: "u-1",
      workspaces: [],
      isAdmin: false,
      activeWorkspaceId: null,
    };
    expect(await resolveInsertWorkspaceId(ctx)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  getWorkspaceScope (combiné)
// ──────────────────────────────────────────────────────────────────────────
describe("getWorkspaceScope — bundle ctx + filtres", () => {
  it("aucune session → tout null", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const r = await getWorkspaceScope();
    expect(r.ctx).toBeNull();
    expect(r.filter).toBeNull();
    expect(r.insertId).toBeNull();
    expect(r.userFilter).toBeNull();
  });

  it("admin owner → filter=null, userFilter=null, insertId=1er ws", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-1", email: "u@v.site" },
    });
    mockTenantFindFirst.mockResolvedValueOnce({
      id: "tenant-1",
      userId: "user-1",
    });
    mockWorkspaceMemberFindMany.mockResolvedValueOnce([
      {
        workspaceId: "ws-A",
        role: "owner",
        visibilityScope: "all",
        workspace: { tenantId: "tenant-1", id: "ws-A", name: "A", slug: "a" },
      },
    ]);

    const r = await getWorkspaceScope();
    expect(r.ctx!.tenantId).toBe("tenant-1");
    expect(r.filter).toBeNull(); // admin sans filtre
    expect(r.userFilter).toBeNull();
    expect(r.insertId).toBe("ws-A");
  });
});
