// GET /api/auth/token?t=<jeton> : ouvre une session Auth.js (JWT) à partir d'un jeton de connexion.
//
// Une seule origine de jeton : `sso_login_tokens`, émis par le rebond signé du Hub (/api/sso/issue-magic-link),
// par provision ou par attach-member. Haché en base (SHA-256), lié à l'utilisateur, à usage unique, borné dans le temps.
// L'ancien jeton `tenants.prospection_login_token` (en clair, 24 h, sans expiration si sa date manquait, connectait
// le propriétaire) n'est plus accepté depuis le 26/11 : plus aucun code ne l'émettait.
//
// Erreurs (toutes → redirect /login?error=...) : invalid_token, token_used, token_expired, server_error.
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { AUTO_BOUNCE_COOKIE, LOGGED_OUT_COOKIE, safeReturnPath } from "@/lib/auth/auto-bounce";
import { cookieEspace, espacesDe } from "@/lib/auth/espaces";
import { attacher } from "@/lib/liaisons/poignee";

const SESSION_MAX_AGE_S = 60 * 60 * 24 * 90; // 90 jours (cf auth.config.ts)

// Cookie name utilisé par Auth.js v5. Préfixe __Secure- en HTTPS prod/staging,
// nom plain en localhost (le middleware Auth.js gère les 2 via env.AUTH_URL).
const COOKIE_NAME_SECURE = "__Secure-authjs.session-token";
const COOKIE_NAME_PLAIN = "authjs.session-token";

function baseUrlFromRequest(request: NextRequest): string {
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

function redirectLogin(baseUrl: string, error: string) {
  return NextResponse.redirect(new URL(`/login?error=${error}`, baseUrl));
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  const baseUrl = baseUrlFromRequest(request);
  const returnPath = safeReturnPath(request.nextUrl.searchParams.get("next"), baseUrl);

  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  // Jeton de rebond Hub. Le hash permet de ne jamais stocker le jeton en clair.
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let ssoToken;
  try {
    ssoToken = await prisma.ssoLoginToken.findUnique({ where: { tokenHash } });
  } catch (err) {
    console.error(`[auth/token] DB lookup failed: ${(err as Error).message}`);
    return redirectLogin(baseUrl, "server_error");
  }
  if (ssoToken) {
    if (ssoToken.usedAt) return redirectLogin(baseUrl, "token_used");
    if (ssoToken.expiresAt.getTime() < Date.now()) {
      return redirectLogin(baseUrl, "token_expired");
    }
    const consumed = await prisma.ssoLoginToken.updateMany({
      where: { tokenHash, usedAt: null },
      data: { usedAt: new Date(), delegation: null },
    });
    if (consumed.count === 0) return redirectLogin(baseUrl, "token_used");
    const sid = randomUUID();
    if (ssoToken.delegation) {
      // Une liaison indisponible n'empêche jamais d'entrer.
      const ok = await attacher(ssoToken.delegation, tokenHash, sid, ssoToken.userId).catch(() => false);
      if (!ok) console.warn(`[auth/token] délégation non attachée user=${ssoToken.userId}`);
    }
    const reponse = await createSessionResponse(ssoToken.userId, baseUrl, "sso", returnPath, sid);
    await poserEspace(reponse, ssoToken.userId, request.nextUrl.searchParams.get("espace"));
    return reponse;
  }

  console.warn("[auth/token] jeton inconnu");
  return redirectLogin(baseUrl, "invalid_token");
}

/** L'organisation où l'on travaillait au Hub (VER-252) : posée seulement si l'utilisateur en est membre, sans jamais empêcher d'entrer. */
async function poserEspace(reponse: NextResponse, userId: string, espace: string | null): Promise<void> {
  if (!espace) return;
  try {
    if ((await espacesDe(userId)).some((e) => e.id === espace)) reponse.cookies.set(cookieEspace(espace));
  } catch {
    console.warn("[auth/token] organisation non posée");
  }
}

async function createSessionResponse(
  userId: string,
  baseUrl: string,
  origin: string,
  returnPath: string | null,
  sid: string = randomUUID(),
): Promise<NextResponse> {
  // Récupère le user pour signer la session. (Le schema Tenant n'a pas de
  // relation Prisma `user` — on join à la main par userId.)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, image: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    console.error(`[auth/token] No active user for userId=${userId} (${origin})`);
    return redirectLogin(baseUrl, "server_error");
  }

  // Crée la session Auth.js. On signe un JWT compatible avec ce qu'attend
  // le middleware Auth.js (cf src/lib/auth-config.ts callbacks `jwt` + `session`
  // qui mettent `uid` sur token, puis `user.id` sur session).
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error("[auth/token] AUTH_SECRET missing — cannot sign session");
    return redirectLogin(baseUrl, "server_error");
  }

  const isProd = process.env.NODE_ENV === "production";
  const cookieName = isProd ? COOKIE_NAME_SECURE : COOKIE_NAME_PLAIN;

  const jwt = await encode({
    token: {
      sub: user.id,
      uid: user.id,
      sid,
      authAt: Date.now(),
      email: user.email,
      name: user.name ?? undefined,
      picture: user.image ?? undefined,
    },
    secret,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE_S,
  });

  console.log(
    `[auth/token] Session created for user=${user.id} ${origin}`,
  );

  const response = NextResponse.redirect(new URL(returnPath ?? "/", baseUrl));
  // Connexion réussie : l'anti-boucle et la déconnexion explicite sont levés.
  response.cookies.delete(AUTO_BOUNCE_COOKIE);
  response.cookies.delete(LOGGED_OUT_COOKIE);
  response.cookies.set({
    name: cookieName,
    value: jwt,
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return response;
}
