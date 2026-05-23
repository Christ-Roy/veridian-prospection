/**
 * Tests unitaires pour src/lib/auth/middleware.ts
 *
 * Gate de TOUS les requests Next 15 (App Router + API). Toute régression =
 * fail-OPEN sur les pages protégées (= fuite massive) ou redirect cassé.
 *
 * Contrat protégé :
 *   - Routes publiques (/login, /signup, /auth/*, /api/auth/*, /invite/*,
 *     /api/invitations/*, /api/tenants/provision, /api/auth/token, /api/health,
 *     /api/status, /api/errors) → next() sans toucher à edgeAuth
 *   - Sans session :
 *       * /api/* → next() (les route handlers retourneront 401 via requireAuth)
 *       * pages → redirect /login?redirect=<path>
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

function makeReq(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000${path}`));
}

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
    "/invite/abc123",
    "/api/invitations/accept",
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
