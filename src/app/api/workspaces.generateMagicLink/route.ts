/**
 * POST /api/workspaces.generateMagicLink — contrat Hub §5.6.
 *
 * Le Hub appelle cet endpoint quand l'user clique "Open Prospection" depuis
 * le dashboard Hub. Il fournit le Bearer api_key tenant (1 api_key = 1
 * workspace, contrat §6.2) + l'email du user. On regénère un loginToken
 * one-shot, on le persiste sur le Tenant, et on retourne un magic_link +
 * auto_login_url qui réutilise le mécanisme existant /api/auth/token.
 *
 * Auth :
 *  - 401 invalid_bearer : header Authorization absent ou mal formé
 *  - 401 invalid_api_key : api_key inconnue côté DB (hash ne match aucun workspace)
 *
 * Logique métier :
 *  - 400 invalid_payload : body JSON invalide / user_email manquant ou mal formé
 *  - 404 user_not_member : user_email pas dans workspace_members du workspace
 *    associé à l'api_key (cas Bob a l'api_key du tenant Acme mais demande un
 *    magic link pour alice@autre.com)
 *  - 200 success : { magic_link, auto_login_url, expires_at }
 *
 * Note conformité §5.6 : "409 si api_key partagée entre workspaces". Chez
 * Prospection ce cas est rendu impossible par l'UNIQUE index sur
 * workspaces.api_key_hash → jamais retourné en pratique.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { extractBearerApiKey } from "@/lib/hub/hmac";
import { hashApiKey } from "@/lib/hub/apiKey";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h cohérent /api/auth/token

export async function POST(request: NextRequest) {
  // ─── Auth Bearer api_key ──────────────────────────────────────────────────
  const extracted = extractBearerApiKey(request.headers.get("authorization"));
  if (!extracted.ok) {
    return NextResponse.json({ error: "invalid_bearer" }, { status: 401 });
  }

  const expectedHash = hashApiKey(extracted.apiKey);

  // Lookup workspace par hash (UNIQUE index → O(1)). On compare aussi via
  // timingSafeEqual pour défense en profondeur (le findFirst Postgres compare
  // déjà mais on évite tout risque résiduel de timing leak).
  const workspace = await prisma.workspace.findFirst({
    where: { apiKeyHash: expectedHash, deletedAt: null },
    select: { id: true, tenantId: true, apiKeyHash: true },
  });
  if (!workspace || !workspace.apiKeyHash) {
    return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });
  }
  // Vérif temps-constant supplémentaire (paranoïa).
  const stored = Buffer.from(workspace.apiKeyHash);
  const computed = Buffer.from(expectedHash);
  if (stored.length !== computed.length || !timingSafeEqual(stored, computed)) {
    return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });
  }

  // ─── Parse body ───────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const userEmail =
    typeof body === "object" && body !== null && "user_email" in body
      ? String((body as Record<string, unknown>).user_email).trim().toLowerCase()
      : "";
  if (!userEmail || !EMAIL_RE.test(userEmail) || userEmail.length > 254) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // ─── Vérif user membre du workspace ───────────────────────────────────────
  const user = await prisma.user.findFirst({
    where: { email: userEmail, deletedAt: null },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "user_not_member" }, { status: 404 });
  }
  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: workspace.id,
      userId: user.id,
      deletedAt: null,
    },
    select: { userId: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "user_not_member" }, { status: 404 });
  }

  // ─── Génère + persiste token one-shot sur Tenant ──────────────────────────
  // Réutilise le mécanisme existant /api/auth/token (cf migration 0008). Le
  // token est lié au Tenant (1 tenant = 1 user owner pour l'instant, donc le
  // user qui consomme le magic link est forcément le owner du tenant — OK
  // pour MVP, à revisiter quand multi-membre cross-app v1.3 livré).
  const loginToken = randomBytes(32).toString("hex");
  await prisma.tenant.update({
    where: { id: workspace.tenantId },
    data: {
      prospectionLoginToken: loginToken,
      prospectionLoginTokenCreatedAt: new Date(),
      prospectionLoginTokenUsedAt: null,
    },
  });

  const appUrl =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://prospection.app.veridian.site";
  const autoLoginUrl = `${appUrl}/api/auth/token?t=${loginToken}`;
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  return NextResponse.json({
    magic_link: autoLoginUrl,
    auto_login_url: autoLoginUrl,
    expires_at: expiresAt,
  });
}
