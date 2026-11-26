import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/middleware";
import { ENTETE, nonce, politique } from "@/lib/csp";

/**
 * Session (Auth.js, rebond Hub), puis CSP à nonce sur chaque réponse (VER-265) : Next lit le nonce dans l'en-tête
 * `content-security-policy` de la requête et l'appose à ses propres scripts (le layout racine lit `headers()`).
 */
export async function middleware(request: NextRequest) {
  const n = nonce();
  const csp = politique(n);
  const h = new Headers(request.headers);
  h.set("x-nonce", n);
  h.set("content-security-policy", csp);
  const r = await updateSession(request, () => NextResponse.next({ request: { headers: h } }));
  r.headers.set(ENTETE, csp);
  return r;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.json|sw\\.js|icons/.*|api/push/vapid-key|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
