/**
 * GET /api/integrations/openrouter/connect
 *
 * Démarre le flow OAuth PKCE OpenRouter :
 *   1. Génère verifier (cookie HTTP-only signé via JSON.stringify + HMAC AUTH_SECRET)
 *   2. Génère state CSRF (même cookie)
 *   3. Redirect vers openrouter.ai/auth?callback_url=...&code_challenge=...&state=...
 *
 * À user-level : auth required. Le user qui clique connecte SON compte.
 *
 * Le cookie expire en 10 min (largement assez pour le user-flow OAuth) et
 * est consommé une seule fois côté callback (delete avant la redirection).
 */
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { requireAuth } from "@/lib/auth/api-auth";
import {
  buildAuthorizeUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from "@/lib/openrouter/pkce";
import {
  PKCE_COOKIE_NAME,
  PKCE_COOKIE_MAX_AGE_S,
  signPayload,
} from "@/lib/openrouter/cookie";

function getCallbackUrl(req: NextRequest): string {
  // En prod, NEXTAUTH_URL est fiable. En dev/staging, on tombe sur l'origin
  // de la requête (sécurise contre header forging seulement parce qu'on est
  // déjà derrière reverse-proxy Traefik qui set host correctement).
  const base = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  return `${base.replace(/\/$/, "")}/api/integrations/openrouter/callback`;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();
  const nonce = randomBytes(8).toString("base64url"); // anti-replay multi-tab
  const exp = Math.floor(Date.now() / 1000) + PKCE_COOKIE_MAX_AGE_S;

  const callbackUrl = getCallbackUrl(req);
  const signed = signPayload({
    verifier,
    state,
    userId: auth.user.id,
    nonce,
    exp,
  });

  const authorize = buildAuthorizeUrl({ callbackUrl, codeChallenge: challenge, state });
  const res = NextResponse.redirect(authorize);
  res.cookies.set({
    name: PKCE_COOKIE_NAME,
    value: signed,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PKCE_COOKIE_MAX_AGE_S,
  });
  return res;
}
