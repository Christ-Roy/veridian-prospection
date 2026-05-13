/**
 * Auth.js v5 — équivalent edge-safe de src/lib/supabase/middleware.ts
 *
 * Auth.js v5 fournit son propre middleware via NextAuth(authConfig).
 * Ce fichier expose une fonction `updateSession` à appeler depuis
 * `src/middleware.ts` pour gérer les redirects login.
 */
import { type NextRequest, NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import NextAuth from "next-auth";

const { auth: edgeAuth } = NextAuth(authConfig);

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Public routes — no auth required
  const isPublicRoute =
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/auth/") ||
    path.startsWith("/api/auth/") ||
    path.startsWith("/invite/") ||
    path.startsWith("/api/invitations/") ||
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
    // Pages : redirect login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
