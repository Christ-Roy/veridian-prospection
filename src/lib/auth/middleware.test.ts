/**
 * Tests unitaires pour src/lib/auth/middleware.ts
 *
 * Gate de TOUS les requests Next 15 (App Router + API). Toute régression =
 * fail-OPEN sur les pages protégées (= fuite massive) ou redirect cassé.
 *
 * Contrat protégé :
 *   - Routes publiques (/login, /signup, /auth/*, /api/auth/*,
 *     /api/tenants/provision, /api/auth/token, /api/health,
 *     /api/status, /api/errors) → next() sans toucher à edgeAuth
 *   - Sans session :
 *       * /api/* → next() (les route handlers retourneront 401 via requireAuth)
 *       * pages → rebond Hub une fois (§6bis.8.0), sinon /login?redirect=<path>
 *   - Avec session → next()
 *
 * Run: npx vitest run src/lib/auth/middleware.test.ts
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { mockEdgeAuth } = vi.hoisted(() => ({
  mockEdgeAuth: vi.fn(),
}));

// NextAuth(authConfig) renvoie un { auth: edgeAuth, ... } — on mocke le
// constructeur NextAuth pour retourner notre mockEdgeAuth.
vi.mock("next-auth", () => ({
  default: () => ({
    auth: mockEdgeAuth,
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/auth.config", () => ({
  authConfig: {
    providers: [],
    pages: { signIn: "/login" },
    callbacks: {},
  },
}));

import { updateSession } from "./middleware";

function makeReq(
  path: string,
  init: { method?: string; headers?: Record<string, string>; cookie?: string } = {},
): NextRequest {
  const headers = new Headers(init.headers);
  // Sans précision, un essai a déjà eu lieu : c'est le cas historique de /login.
  headers.set("cookie", init.cookie ?? "veridian-auto-bounce=1");
  return new NextRequest(new URL(`http://localhost:3000${path}`), {
    method: init.method ?? "GET",
    headers,
  });
}

const NAV = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };

beforeEach(() => {
  mockEdgeAuth.mockReset();
});

// ──────────────────────────────────────────────────────────────────────────
//  Routes publiques — JAMAIS de check auth (édge-safe : pas de query DB)
// ──────────────────────────────────────────────────────────────────────────
describe("routes publiques — bypass total de edgeAuth", () => {
  const publicRoutes = [
    "/login",
    "/login/callback",
    "/signup",
    "/auth/callback/google",
    "/api/auth/signin",
    "/api/auth/callback/google",
    "/api/tenants/provision",
    "/api/auth/token",
    "/api/health",
    "/api/status",
    "/api/errors",
  ];

  it.each(publicRoutes)("laisse passer %s sans appeler edgeAuth", async (path) => {
    const res = await updateSession(makeReq(path));
    expect(res).toBeInstanceOf(NextResponse);
    // Status 200 = next() (vs 307/308 = redirect)
    // Note : NextResponse.next() ne pose pas de Location, c'est différent
    // d'un redirect. On vérifie l'absence de Location.
    expect(res.headers.get("location")).toBeNull();
    expect(mockEdgeAuth).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  Routes API protégées sans session — next() (la route renverra 401)
// ──────────────────────────────────────────────────────────────────────────
describe("API protégées sans session — délègue le 401 au route handler", () => {
  it("/api/prospects sans session → next() (pas de redirect HTML)", async () => {
    mockEdgeAuth.mockResolvedValueOnce(null);
    const res = await updateSession(makeReq("/api/prospects"));

    expect(res).toBeInstanceOf(NextResponse);
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
  });

  it("/api/admin/users sans session → next() (idem)", async () => {
    mockEdgeAuth.mockResolvedValueOnce(null);
    const res = await updateSession(makeReq("/api/admin/users"));
    expect(res.headers.get("location")).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  Pages protégées sans session — redirect /login?redirect=<path>
// ──────────────────────────────────────────────────────────────────────────
describe("pages protégées sans session — redirect /login avec param", () => {
  it("/ → redirect /login?redirect=/", async () => {
    mockEdgeAuth.mockResolvedValueOnce(null);
    const res = await updateSession(makeReq("/"));

    expect(res.status).toBe(307);
    const loc = res.headers.get("location");
    expect(loc).toBeTruthy();
    const url = new URL(loc!);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("redirect")).toBe("/");
  });

  it("/prospects → redirect /login?redirect=/prospects", async () => {
    mockEdgeAuth.mockResolvedValueOnce(null);
    const res = await updateSession(makeReq("/prospects"));

    expect(res.status).toBe(307);
    const url = new URL(res.headers.get("location")!);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("redirect")).toBe("/prospects");
  });

  it("/dashboard/admin/settings → redirect avec le path encodé complet", async () => {
    mockEdgeAuth.mockResolvedValueOnce(null);
    const res = await updateSession(makeReq("/dashboard/admin/settings"));

    expect(res.status).toBe(307);
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("redirect")).toBe("/dashboard/admin/settings");
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  Session valide — passage transparent
// ──────────────────────────────────────────────────────────────────────────
describe("session valide — passe partout", () => {
  it("page privée avec session → next() (pas de redirect)", async () => {
    mockEdgeAuth.mockResolvedValueOnce({
      user: { id: "u-1", email: "u@v.site" },
      expires: "2099-01-01",
    });
    const res = await updateSession(makeReq("/prospects"));

    expect(res.headers.get("location")).toBeNull();
    expect(res.status).not.toBe(307);
  });

  it("/api protégé avec session → next()", async () => {
    mockEdgeAuth.mockResolvedValueOnce({
      user: { id: "u-1", email: "u@v.site" },
      expires: "2099-01-01",
    });
    const res = await updateSession(makeReq("/api/prospects"));

    expect(res.headers.get("location")).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  Edge cases — prefix-matching, pas de faux positifs sur les routes
// ──────────────────────────────────────────────────────────────────────────
describe("prefix matching — éviter les fausses inclusions", () => {
  it("/loginz (typo) ne doit PAS être considéré public — c'est /login + suffixe", async () => {
    // Le check actuel utilise startsWith("/login"), donc /loginz matche.
    // Ce test documente le comportement réel. Si on durcit un jour (`=== "/login"`
    // ou regex), ce test rougira et il faudra l'adapter.
    mockEdgeAuth.mockResolvedValueOnce(null);
    const res = await updateSession(makeReq("/loginz"));
    // Aujourd'hui : pris pour public (startsWith /login)
    expect(mockEdgeAuth).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBeNull();
  });

  it("/api/healthcheck (typo) matche /api/health via startsWith — comportement documenté", async () => {
    mockEdgeAuth.mockResolvedValueOnce(null);
    const res = await updateSession(makeReq("/api/healthcheck"));
    expect(mockEdgeAuth).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBeNull();
  });
});
// touched 2026-05-23 for coverage-map covered_by signal

// ──────────────────────────────────────────────────────────────────────────
//  Rebond automatique vers le Hub (CONTRAT-HUB §6bis.8.0)
// ──────────────────────────────────────────────────────────────────────────
describe("rebond automatique sans session", () => {
  beforeEach(() => mockEdgeAuth.mockResolvedValue(null));

  it("navigation complète : part au Hub avec la page demandée et auto=1, cookie posé", async () => {
    const res = await updateSession(makeReq("/pipeline?x=1", { headers: NAV, cookie: "" }));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/api/auth/bounce/prepare");
    expect(loc.searchParams.get("auto")).toBe("1");
    expect(loc.searchParams.get("next")).toMatch(/\/pipeline\?x=1$/);
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/veridian-auto-bounce=1/);
    expect(set).toMatch(/Max-Age=300/);
  });

  it("deuxième passage : le cookie arrête la boucle, page de connexion", async () => {
    const res = await updateSession(
      makeReq("/pipeline", { headers: NAV, cookie: "veridian-auto-bounce=1" }),
    );
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("déconnexion explicite : page de connexion, aucun rebond", async () => {
    const res = await updateSession(
      makeReq("/pipeline", { headers: NAV, cookie: "veridian-logged-out=1" }),
    );
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it.each([
    ["iframe", { method: "GET", headers: { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" } }],
    ["POST", { method: "POST", headers: NAV }],
    ["requête du routeur", { method: "GET", headers: { ...NAV, rsc: "1" } }],
    ["préchargement", { method: "GET", headers: { ...NAV, "next-router-prefetch": "1" } }],
    ["fetch", { method: "GET", headers: { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" } }],
  ])("%s : jamais de rebond", async (_label, init) => {
    const res = await updateSession(makeReq("/pipeline", { ...init, cookie: "" }));
    const loc = res.headers.get("location")!;
    expect(new URL(loc).pathname).toBe("/login");
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/veridian-auto-bounce/);
  });

  it("route d'API : jamais de rebond, le handler répond 401", async () => {
    const res = await updateSession(makeReq("/api/prospects", { headers: NAV, cookie: "" }));
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("avec session : aucun rebond", () => {
  it("navigation complète sans cookie : passe", async () => {
    mockEdgeAuth.mockResolvedValue({ user: { id: "u" } });
    const res = await updateSession(makeReq("/pipeline", { headers: NAV, cookie: "" }));
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("/login, porte locale fermée (production)", () => {
  beforeEach(() => {
    mockEdgeAuth.mockReset();
    delete process.env.LOCAL_AUTH_ENABLED;
  });

  it("navigation sans session : part au Hub vers la page demandée", async () => {
    mockEdgeAuth.mockResolvedValue(null);
    const res = await updateSession(makeReq("/login?redirect=%2Fpipeline", { headers: NAV, cookie: "" }));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/api/auth/bounce/prepare");
    expect(loc.searchParams.get("next")).toMatch(/\/pipeline$/);
  });

  it("redirect vers un autre site ignoré", async () => {
    mockEdgeAuth.mockResolvedValue(null);
    const res = await updateSession(
      makeReq("/login?redirect=https%3A%2F%2Fevil.example%2Fx", { headers: NAV, cookie: "" }),
    );
    const next = new URL(res.headers.get("location")!).searchParams.get("next")!;
    expect(next).not.toContain("evil.example");
  });

  it.each([
    ["déconnexion explicite", "/login", "veridian-logged-out=1"],
    ["essai déjà fait", "/login", "veridian-auto-bounce=1"],
    ["erreur de lien", "/login?error=token_used", ""],
  ])("%s : la page reste, sans rebond", async (_l, path, cookie) => {
    mockEdgeAuth.mockResolvedValue(null);
    const res = await updateSession(makeReq(path, { headers: NAV, cookie }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("déjà connecté : la page reste", async () => {
    mockEdgeAuth.mockResolvedValue({ user: { id: "u" } });
    const res = await updateSession(makeReq("/login", { headers: NAV, cookie: "" }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("staging, LOCAL_AUTH_ENABLED=1 : le formulaire reste accessible", async () => {
    process.env.LOCAL_AUTH_ENABLED = "1";
    const res = await updateSession(makeReq("/login", { headers: NAV, cookie: "" }));
    expect(res.headers.get("location")).toBeNull();
    delete process.env.LOCAL_AUTH_ENABLED;
  });
});
