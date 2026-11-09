/**
 * Middleware edge-safe Auth.js v5 — appelé depuis `src/middleware.ts`
 * pour gérer les redirects login sur les routes protégées.
 */
import { type NextRequest, NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import NextAuth from "next-auth";
import {
  AUTO_BOUNCE_COOKIE,
  AUTO_BOUNCE_TTL_S,
  LOGGED_OUT_COOKIE,
  isFullNavigation,
  safeReturnPath,
} from "@/lib/auth/auto-bounce";
import { isLocalAuthEnabled } from "@/lib/auth/local-auth";

const { auth: edgeAuth } = NextAuth(authConfig);

function canAutoBounce(request: NextRequest): boolean {
  return (
    isFullNavigation(request) &&
    !request.cookies.has(LOGGED_OUT_COOKIE) &&
    !request.cookies.has(AUTO_BOUNCE_COOKIE)
  );
}

function siteOrigin(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
}

function bounceToHub(next: string, origin: string): NextResponse {
  const hub = process.env.NEXT_PUBLIC_HUB_URL || "https://app.veridian.site";
  const response = NextResponse.redirect(
    `${hub}/api/auth/bounce/prepare?next=${encodeURIComponent(next)}&auto=1`,
  );
  response.cookies.set({
    name: AUTO_BOUNCE_COOKIE,
    value: "1",
    path: "/",
    maxAge: AUTO_BOUNCE_TTL_S,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
  });
  return response;
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Porte locale fermée : /login n'est plus qu'un passage vers le Hub. Reste une page
  // à bouton après une déconnexion explicite, un essai raté ou une erreur de lien.
  if (
    path === "/login" &&
    !isLocalAuthEnabled() &&
    !request.nextUrl.searchParams.has("error") &&
    canAutoBounce(request) &&
    !(await edgeAuth())
  ) {
    const origin = siteOrigin(request);
    const target = safeReturnPath(request.nextUrl.searchParams.get("redirect"), origin) ?? "/";
    return bounceToHub(`${origin}${target}`, origin);
  }

  // Public routes — no auth required
  const isPublicRoute =
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/auth/") ||
    path.startsWith("/api/auth/") ||
    path.startsWith("/api/tenants/provision") ||
    path.startsWith("/api/auth/token") ||
    path.startsWith("/api/health") ||
    path.startsWith("/api/status") ||
    path.startsWith("/api/errors");

  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Vérifier la session via Auth.js edge-safe
  const session = await edgeAuth();

  if (!session) {
    if (path.startsWith("/api/")) {
      // API : laisser la route handler retourner 401 via requireAuth()
      return NextResponse.next();
    }
    // Pages : rebond automatique vers le Hub, une fois, sur une vraie navigation et
    // jamais après une déconnexion explicite (CONTRAT-HUB §6bis.8.0).
    if (canAutoBounce(request)) {
      const origin = siteOrigin(request);
      return bounceToHub(`${origin}${path}${request.nextUrl.search}`, origin);
    }
    // Sinon : page de connexion locale
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
