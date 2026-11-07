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
 *   { "hub_user_id": "<uuid>", "email": "<string>", "email_proven"?: true }
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
 * Le jeton vit dans `sso_login_tokens` (haché, one-shot, 15 min, lié au USER)
 * et non sur le Tenant : consommer un jeton de Tenant connecte son propriétaire,
 * ce qui est faux pour un membre invité. GET /api/auth/token?t=... consomme.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { verifyHubHmac } from "@/lib/hub/hmac";
import { isRateLimited } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min, CONTRAT-HUB §6bis.8.3

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
  // Match par hub_user_id en priorité (lien explicite Hub↔local). Le repli par
  // email sert UNIQUEMENT à rattacher un compte encore sans lien, et seulement si
  // le Hub atteste l'adresse (`email_proven`, §3.8) : un email ne doit jamais
  // ouvrir un compte déjà lié à une autre identité Hub.
  // On NE fait PAS de resolveOrCreateUserFromHub ici (le ticket §6bis.8 interdit
  // l'auto-création, c'est au Hub de proposer signup à la place).
  // La colonne hub_user_id est un UUID : un autre format (cuid Hub) fait lever
  // Prisma (P2023) et ne pourrait pas être rattaché, donc refus net.
  if (!UUID_RE.test(hubUserId)) {
    console.warn(`[sso/issue-magic-link] hub_user_id non UUID refusé: ${hubUserId}`);
    return NextResponse.json(
      { error: "user_not_in_app", hint: "hub_user_id is not a uuid" },
      { status: 400 },
    );
  }
  let user = await prisma.user.findFirst({
    where: { hubUserId, deletedAt: null },
    select: { id: true, hubUserId: true },
  });
  if (!user && obj.email_proven === true) {
    user = await prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, hubUserId: true },
    });
  }
  if (!user) {
    return NextResponse.json(
      { error: "user_not_in_app", hint: "user not found in Prospection" },
      { status: 400 },
    );
  }
  if (user.hubUserId && user.hubUserId !== hubUserId) {
    console.warn(
      `[sso/issue-magic-link] hub_user_id conflict user=${user.id} local=${user.hubUserId} hub=${hubUserId}`,
    );
    return NextResponse.json(
      { error: "user_not_in_app", hint: "email linked to another hub identity" },
      { status: 400 },
    );
  }

  // Accès = propriétaire d'un tenant actif OU membre d'un workspace d'un tenant
  // actif. Sinon user_not_in_app (User créé mais tenant soft-deleted, ou retiré).
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id, deletedAt: null, workspace: { deletedAt: null } },
    select: { workspace: { select: { tenantId: true } } },
  });
  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [
        { userId: user.id },
        { id: { in: memberships.map((m) => m.workspace.tenantId) } },
      ],
      deletedAt: null,
      status: { not: "deleted" },
    },
    orderBy: { updatedAt: "desc" }, // multi-workspaces : dernier actif (§6bis.8)
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json(
      { error: "user_not_in_app", hint: "no active tenant" },
      { status: 400 },
    );
  }

  // Rattachement §3.7 au premier contact : la condition hubUserId null rend
  // l'écriture atomique, un lien existant n'est jamais réécrit.
  if (!user.hubUserId) {
    const userId = user.id;
    await prisma.user
      .updateMany({ where: { id: userId, hubUserId: null }, data: { hubUserId } })
      .catch((err: Error) =>
        console.warn(
          `[sso/issue-magic-link] backfill hub_user_id failed user=${userId}: ${err.message}`,
        ),
      );
  }

  // ─── Génère + persiste token one-shot ─────────────────────────────────────
  const loginToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  try {
    await prisma.ssoLoginToken.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });
    await prisma.ssoLoginToken.create({
      data: {
        tokenHash: createHash("sha256").update(loginToken).digest("hex"),
        userId: user.id,
        expiresAt,
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

  console.log(
    `[sso/issue-magic-link] issued user=${user.id} tenant=${tenant.id} expires=${expiresAt.toISOString()}`,
  );

  return NextResponse.json({
    magic_link_url: magicLinkUrl,
    expires_at: expiresAt.toISOString(),
  });
}
