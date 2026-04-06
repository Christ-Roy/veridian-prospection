import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // No Supabase configured — allow all requests (internal tool mode)
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: "", ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  // Refresh session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Public routes — no auth required
  const isPublicRoute =
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/invite/") ||
    path.startsWith("/api/invitations/") ||
    path.startsWith("/api/tenants/provision") ||
    path.startsWith("/api/auth/token") ||
    path.startsWith("/api/health") ||
    path.startsWith("/api/status") ||
    path.startsWith("/api/errors");

  if (isPublicRoute) {
    return response;
  }

  // Protected routes — handle unauthenticated access
  if (!user) {
    // API routes: let the route handler return 401 via requireAuth()
    if (path.startsWith("/api/")) {
      return response;
    }
    // Pages: redirect to login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
