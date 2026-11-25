// Auth.js v5 catch-all route handler.
// Gère tous les endpoints /api/auth/* : signin, signout, callback, session, csrf...
import type { NextRequest } from "next/server";

import { cookieDeconnexion } from "@/lib/auth/auto-bounce";
import { handlers } from "@/lib/auth-config";

export const { GET } = handlers;

/** Se déconnecter tient : sans ce cookie, la page suivante repart par le rebond silencieux du Hub et rouvre la session. */
export async function POST(request: NextRequest) {
  const res = await handlers.POST(request);
  if (!new URL(request.url).pathname.endsWith("/api/auth/signout") || res.status >= 400) return res;
  const headers = new Headers(res.headers);
  headers.append("set-cookie", cookieDeconnexion());
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
