// Autologin one-shot Hub→Prospection.
//
// Flow :
//   1. Hub appelle POST /api/tenants/provision (HMAC) → on génère un
//      loginToken random et on le persiste sur le Tenant Prisma local.
//   2. Hub renvoie au browser un login_url contenant ?t=<token>.
//   3. Le browser de l'user ouvre GET /api/auth/token?t=<token>.
//   4. On valide le token contre la DB Prisma locale (plus de Supabase
//      depuis 2026-05-20), on marque le token used (one-shot), on crée
//      une session Auth.js JWT (encodage manuel compatible session
//      strategy="jwt") et on redirige vers /.
//
// Sécurité :
//   - Token = 32 bytes random hex (256 bits d'entropie) → unguessable
//   - Validité 24h (`MAX_AGE_MS`)
//   - One-shot : `prospectionLoginTokenUsedAt` posé au premier check OK
//   - Validation via Prisma index `tenants_prospection_login_token_idx`
//
// Erreurs possibles (toutes → redirect /login?error=...) :
//   - invalid_token : token absent ou inconnu en DB
//   - token_used    : déjà consommé une fois
//   - token_expired : > 24h depuis création
//   - server_error  : exception interne (loggée)
import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 heures
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

  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  console.log(`[auth/token] Validating token prefix=${token.slice(0, 8)}...`);

  let tenant;
  try {
    tenant = await prisma.tenant.findFirst({
      where: { prospectionLoginToken: token },
      select: {
        id: true,
        userId: true,
        prospectionLoginTokenCreatedAt: true,
        prospectionLoginTokenUsedAt: true,
      },
    });
  } catch (err) {
    console.error(`[auth/token] DB lookup failed: ${(err as Error).message}`);
    return redirectLogin(baseUrl, "server_error");
  }

  if (!tenant) {
    console.warn(`[auth/token] Token not found, prefix=${token.slice(0, 8)}...`);
    return redirectLogin(baseUrl, "invalid_token");
  }

  if (tenant.prospectionLoginTokenUsedAt) {
    console.warn(`[auth/token] Token already used for tenant ${tenant.id}`);
    return redirectLogin(baseUrl, "token_used");
  }

  if (tenant.prospectionLoginTokenCreatedAt) {
    const ageMs = Date.now() - tenant.prospectionLoginTokenCreatedAt.getTime();
    if (ageMs > MAX_AGE_MS) {
      console.warn(
        `[auth/token] Token expired for tenant ${tenant.id}, age=${Math.round(ageMs / 3600000)}h`,
      );
      return redirectLogin(baseUrl, "token_expired");
    }
  }

  // Marque used en premier (anti race condition double-consommation). Si une
  // 2e tab ouvre le même token en même temps, seule la première qui passe
  // ici sera authentifiée (l'update est atomique).
  const updated = await prisma.tenant.updateMany({
    where: { id: tenant.id, prospectionLoginTokenUsedAt: null },
    data: { prospectionLoginTokenUsedAt: new Date() },
  });
  if (updated.count === 0) {
    console.warn(
      `[auth/token] Race condition — another tab already consumed the token for tenant ${tenant.id}`,
    );
    return redirectLogin(baseUrl, "token_used");
  }

  // Récupère le user pour signer la session. (Le schema Tenant n'a pas de
  // relation Prisma `user` — on join à la main par userId.)
  const user = await prisma.user.findUnique({
    where: { id: tenant.userId },
    select: { id: true, email: true, name: true, image: true },
  });
  if (!user) {
    console.error(`[auth/token] No user found for tenant ${tenant.id} userId=${tenant.userId}`);
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
      email: user.email,
      name: user.name ?? undefined,
      picture: user.image ?? undefined,
    },
    secret,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE_S,
  });

  console.log(
    `[auth/token] Session created for user=${user.id} tenant=${tenant.id}`,
  );

  const response = NextResponse.redirect(new URL("/", baseUrl));
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
