/**
 * POST /api/sso/issue-magic-link — Couche 4 SSO (CONTRAT-HUB.md §6bis.8).
 *
 * Appelé par le Hub après un OAuth réussi (Google/Microsoft) pour générer
 * une URL d'autologin one-shot vers Prospection. Le Hub redirige ensuite
 * l'user navigateur vers cette URL pour reprendre la session côté app.
 *
 * Auth : HMAC entrant `${ts}.${rawBody}` (pattern A du CONTRAT-HUB.md §6.1,
 * helper `lib/hub/hmac.ts:verifyHubHmac`). Pas de Bearer api_key ici : le
 * Hub n'a pas de workspace_id à ce stade — il a juste un hub_user_id et un
 * email qu'il vient de valider via OAuth.
 *
 * Body attendu :
 *   { "hub_user_id": "<uuid>", "email": "<string>" }
 *
 * Réponses :
 *   200 { magic_link_url: "https://prospection.app.veridian.site/api/auth/token?t=..." }
 *   400 { error: "invalid_payload" | "user_not_in_app", hint? }
 *   401 { error: "invalid_hmac" | "missing_secret" }
 *   429 { error: "rate_limited" }  (10/min/user)
 *   500 { error: "server_error" }
 *
 * IMPORTANT : ne PAS auto-créer de workspace si l'user n'est pas dans
 * Prospection (cf ticket §6bis.8 — le Hub redirige vers signup à la
 * place). On répond 400 user_not_in_app et on laisse le Hub décider.
 *
 * Cf. logique magic_link Couche 3 : src/app/api/workspaces.generateMagicLink/route.ts
 * (réutilise le même pattern token one-shot + `prospectionLoginToken` sur
 * Tenant + GET /api/auth/token?t=... pour consommer).
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { verifyHubHmac } from "@/lib/hub/hmac";
import { isRateLimited } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h cohérent /api/auth/token

function getSecret(): string | undefined {
  return process.env.HUB_API_SECRET || process.env.TENANT_API_SECRET;
}

export async function POST(request: NextRequest) {
  // ─── Auth HMAC ────────────────────────────────────────────────────────────
  const secret = getSecret();
  if (!secret) {
    return NextResponse.json({ error: "missing_secret" }, { status: 500 });
  }

  const rawBody = await request.text();
  const sig = request.headers.get("x-veridian-hub-signature");
  const ts = Number(request.headers.get("x-veridian-timestamp"));

  if (!sig) {
    return NextResponse.json({ error: "invalid_hmac" }, { status: 401 });
  }
  const v = verifyHubHmac(secret, ts, rawBody, sig);
  if (!v.ok) {
    return NextResponse.json({ error: "invalid_hmac" }, { status: 401 });
  }

  // ─── Parse body ───────────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (typeof parsed !== "object" || parsed === null) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const obj = parsed as Record<string, unknown>;
  const hubUserId =
    typeof obj.hub_user_id === "string" ? obj.hub_user_id.trim() : "";
  const email =
    typeof obj.email === "string" ? obj.email.trim().toLowerCase() : "";
  if (!hubUserId || !email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // ─── Rate limit 10/min/user ───────────────────────────────────────────────
  if (isRateLimited(`sso:issue-magic-link:${hubUserId}`, 10, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // ─── Lookup user — pas d'auto-création ────────────────────────────────────
  // Match par hub_user_id en priorité (lien explicite Hub↔local), fallback
  // par email pour les comptes legacy pas encore backfillés (§3.7 helper
  // identity.ts). On NE fait PAS de resolveOrCreateUserFromHub ici (le
  // ticket §6bis.8 interdit l'auto-création — c'est au Hub de proposer
  // signup à la place).
  let user = await prisma.user.findFirst({
    where: { hubUserId, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!user) {
    user = await prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, email: true },
    });
  }
  if (!user) {
    return NextResponse.json(
      { error: "user_not_in_app", hint: "user not found in Prospection" },
      { status: 400 },
    );
  }

  // L'user existe — vérifier qu'il a au moins un tenant actif. Sinon
  // user_not_in_app (cas pathologique : User créé mais Tenant soft-deleted
  // ou jamais provisionné).
  const tenant = await prisma.tenant.findFirst({
    where: {
      userId: user.id,
      deletedAt: null,
      status: { not: "deleted" },
    },
    orderBy: { updatedAt: "desc" }, // multi-workspaces : dernier actif (§6bis.8)
    select: { id: true, status: true },
  });
  if (!tenant) {
    return NextResponse.json(
      { error: "user_not_in_app", hint: "no active tenant" },
      { status: 400 },
    );
  }

  // ─── Génère + persiste token one-shot ─────────────────────────────────────
  const loginToken = randomBytes(32).toString("hex");
  try {
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        prospectionLoginToken: loginToken,
        prospectionLoginTokenCreatedAt: new Date(),
        prospectionLoginTokenUsedAt: null,
      },
    });
  } catch (err) {
    console.error(
      `[sso/issue-magic-link] persist token failed user=${user.id}: ${(err as Error).message}`,
    );
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const appUrl =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://prospection.app.veridian.site";
  const magicLinkUrl = `${appUrl}/api/auth/token?t=${loginToken}`;
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  console.log(
    `[sso/issue-magic-link] issued user=${user.id} tenant=${tenant.id} expires=${expiresAt}`,
  );

  return NextResponse.json({
    magic_link_url: magicLinkUrl,
    expires_at: expiresAt,
  });
}
