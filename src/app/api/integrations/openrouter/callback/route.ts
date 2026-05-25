/**
 * GET /api/integrations/openrouter/callback?code=...&state=...
 *
 * Reçoit le callback d'OpenRouter après autorisation user :
 *   1. Récupère + vérifie le cookie PKCE signé (verifier, state, userId, exp)
 *   2. Compare state cookie vs state query (CSRF)
 *   3. Vérifie userId du cookie = user actuellement loggué (anti-link-jack)
 *   4. Exchange code+verifier contre une clé sk-or-v1-... auprès d'OpenRouter
 *   5. Chiffre la clé AES-256-GCM + upsert dans user_openrouter_link
 *   6. Delete le cookie + redirect /settings/mail?ai=connected
 *
 * Erreurs : redirect /settings/mail?ai_error=<reason> (la UI lit ce param
 * pour afficher un toast). Aucun stack trace exposé à l'utilisateur.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { isRateLimited } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { getTenantId } from "@/lib/auth/tenant";
import { exchangeCodeForKey, OpenRouterPkceError } from "@/lib/openrouter/pkce";
import { upsertOpenRouterLink } from "@/lib/openrouter/queries";
import { PKCE_COOKIE_NAME, verifyPayload } from "@/lib/openrouter/cookie";

function redirectWithError(req: NextRequest, reason: string): NextResponse {
  const base = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  const url = new URL(`${base.replace(/\/$/, "")}/settings/mail`);
  url.searchParams.set("ai_error", reason);
  const res = NextResponse.redirect(url);
  res.cookies.delete(PKCE_COOKIE_NAME);
  return res;
}

function redirectOk(req: NextRequest): NextResponse {
  const base = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  const url = new URL(`${base.replace(/\/$/, "")}/settings/mail`);
  url.searchParams.set("ai", "connected");
  const res = NextResponse.redirect(url);
  res.cookies.delete(PKCE_COOKIE_NAME);
  return res;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  if (isRateLimited(`or-callback:${auth.user.id}`, 10, 60_000)) {
    return redirectWithError(req, "rate_limited");
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateQuery = url.searchParams.get("state");
  if (!code || !stateQuery) {
    return redirectWithError(req, "missing_code_or_state");
  }

  // ─── Vérif cookie ─────────────────────────────────────────────────────
  const cookie = req.cookies.get(PKCE_COOKIE_NAME)?.value;
  if (!cookie) {
    return redirectWithError(req, "missing_pkce_cookie");
  }
  const payload = verifyPayload(cookie) as {
    verifier?: string;
    state?: string;
    userId?: string;
    exp?: number;
  } | null;
  if (!payload || !payload.verifier || !payload.state || !payload.userId || !payload.exp) {
    return redirectWithError(req, "invalid_pkce_cookie");
  }

  // Expiration
  if (Math.floor(Date.now() / 1000) > payload.exp) {
    return redirectWithError(req, "pkce_expired");
  }

  // CSRF : state cookie == state query
  if (payload.state !== stateQuery) {
    return redirectWithError(req, "state_mismatch");
  }

  // Anti-link-jack : le cookie a été émis pour CE user.
  if (payload.userId !== auth.user.id) {
    return redirectWithError(req, "user_mismatch");
  }

  // ─── Exchange code → clé API user ─────────────────────────────────────
  let key: string;
  let openrouterUserId: string | undefined;
  try {
    const exchanged = await exchangeCodeForKey({
      code,
      codeVerifier: payload.verifier,
    });
    key = exchanged.key;
    openrouterUserId = exchanged.userId;
  } catch (err) {
    const reason =
      err instanceof OpenRouterPkceError ? `exchange_${err.kind}` : "exchange_failed";
    console.error("[openrouter/callback] exchange failed:", err);
    return redirectWithError(req, reason);
  }

  // ─── Upsert lien chiffré ──────────────────────────────────────────────
  try {
    await upsertOpenRouterLink({
      userId: auth.user.id,
      apiKey: key,
      openrouterEmail: null,
      scope: openrouterUserId ? `openrouter_user:${openrouterUserId}` : null,
    });
  } catch (err) {
    console.error("[openrouter/callback] upsert failed:", err);
    return redirectWithError(req, "storage_failed");
  }

  // ─── Audit ─────────────────────────────────────────────────────────────
  const tenantId = await getTenantId(auth.user.id);
  if (tenantId) {
    void logAudit({
      tenantId,
      actorType: "user",
      actorId: auth.user.id,
      action: "openrouter.connected",
      targetType: "user",
      targetId: auth.user.id,
      metadata: { openrouterUserId: openrouterUserId ?? null },
    });
  }

  return redirectOk(req);
}
