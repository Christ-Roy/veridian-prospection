import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import {
  verifyHubHmac,
  verifyLegacyEmailTsHmac,
  verifyLegacyBearer,
} from "@/lib/hub/hmac";
import { generateApiKey, hashApiKey } from "@/lib/hub/apiKey";
import { resolveOrCreateUserFromHub } from "@/lib/hub/identity";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Crée (idempotent) le User + Tenant local + workspace "default" + membership
 * owner côté Prisma à la suite d'un provisioning Hub.
 *
 * @param userId  UUID Hub (utilisé tel quel comme id User Prospection).
 *                Le Hub doit le transmettre via `metadata.hub_user_id` ou
 *                `user_id` dans le body — sinon on skip avec un warn (le
 *                tenant existera côté Hub mais sans workspace local, le user
 *                ne pourra pas se connecter tant que le Hub n'aura pas
 *                migré au contrat v1.2).
 *
 * @returns api_key en clair (string) si une nouvelle api_key a été générée
 *          pour le workspace default — à retourner au Hub UNE SEULE FOIS.
 *          Retourne null si le workspace avait déjà une api_key (Hub déjà
 *          provisionné, on ne regénère pas pour pas casser son auth) ou
 *          si le user_id est absent (skip workspace setup).
 *
 * Best-effort : on log et on swallow les erreurs pour ne pas casser le flow
 * de provisioning principal (le Hub considère succès dès qu'on a renvoyé
 * api_key + login_url).
 */
async function ensureOwnerWorkspace(
  userId: string,
  email: string,
): Promise<{ apiKey: string | null; localUserId: string } | null> {
  try {
    // CONTRAT-HUB v1.5 §3.7 — `userId` reçu EST le hub_user_id.
    // Le helper backfille hub_user_id + préserve la rétrocompat (legacy id PK).
    const { id: localUserId } = await resolveOrCreateUserFromHub({
      hubUserId: userId,
      email,
    });

    const slugBase = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "tenant";

    let tenant = await prisma.tenant.findFirst({
      where: { userId: localUserId },
      select: { id: true },
    });

    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          userId: localUserId,
          name: `${email.split("@")[0]}'s Workspace`,
          slug: `${slugBase}-${Date.now().toString(36)}`,
          status: "active",
        },
        select: { id: true },
      });
    }

    let workspace = await prisma.workspace.findFirst({
      where: { tenantId: tenant.id, slug: "default" },
      select: { id: true, apiKeyHash: true },
    });
    if (!workspace) {
      workspace = await prisma.workspace.create({
        data: {
          tenantId: tenant.id,
          name: "Default",
          slug: "default",
          createdBy: localUserId,
        },
        select: { id: true, apiKeyHash: true },
      });
    }

    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: localUserId },
      },
      update: { role: "admin" },
      create: {
        workspaceId: workspace.id,
        userId: localUserId,
        role: "admin",
        visibilityScope: "all",
      },
    });

    // Contrat Hub §5.6 + §6.2 — Bearer api_key pour generateMagicLink.
    // Idempotence stricte : si une api_key existe déjà pour ce workspace, on
    // NE la regénère PAS (sinon on invalide la clé que le Hub a stockée
    // après le premier provision). La rotation explicite passera par §5.15
    // v1.2 quand câblée.
    let apiKeyPlain: string | null = null;
    if (!workspace.apiKeyHash) {
      apiKeyPlain = generateApiKey();
      await prisma.workspace.update({
        where: { id: workspace.id },
        data: {
          apiKeyHash: hashApiKey(apiKeyPlain),
          apiKeyCreatedAt: new Date(),
        },
      });
    }

    console.log(
      `[provision] Auto-admin OK: hub_user=${userId} local_user=${localUserId} tenant=${tenant.id} workspace=${workspace.id} api_key_minted=${apiKeyPlain !== null}`,
    );
    return { apiKey: apiKeyPlain, localUserId };
  } catch (err) {
    console.error(`[provision] auto-admin upsert failed for ${email}: ${(err as Error).message}`);
    return null;
  }
}

// Le secret est lu *au runtime* (pas au module-load) pour que les tests
// puissent injecter via vi.hoisted() et que la rotation 6 mois (cf §6.5)
// fonctionne sans redémarrage du process.
function getSecret(): string | undefined {
  return process.env.HUB_API_SECRET || process.env.TENANT_API_SECRET;
}

const ACCEPT_LEGACY_HMAC = process.env.ACCEPT_LEGACY_HMAC !== "0";
const ACCEPT_LEGACY_BEARER = process.env.ACCEPT_LEGACY_BEARER !== "0";

// Simple in-memory rate limiter (10 requests per minute per IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

export async function POST(request: NextRequest) {
  // Rate limit
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const secret = getSecret();
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const rawBody = await request.text();
  let body: {
    email?: string;
    plan?: string;
    timestamp?: number;
    signature?: string;
    user_id?: string;
    metadata?: { hub_user_id?: string };
  };
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const { email, plan, timestamp, signature } = body;
  const hubUserId = body.user_id || body.metadata?.hub_user_id;

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  // 1) Pattern A — HMAC standard contrat §6.1 : signature dans les headers
  //    sur `${timestamp}.${rawBody}`. Source de vérité long terme.
  const headerSig = request.headers.get("x-veridian-hub-signature");
  const headerTs = Number(request.headers.get("x-veridian-timestamp"));

  let authOk = false;
  let authMode: "standard" | "legacy_email_ts" | "legacy_bearer" | null = null;
  let lastFailure = "Unauthorized";

  if (headerSig) {
    const v = verifyHubHmac(secret, headerTs, rawBody, headerSig);
    if (v.ok) {
      authOk = true;
      authMode = "standard";
    } else {
      lastFailure = v.reason === "timestamp_drift" ? "Timestamp expired or invalid"
        : v.reason === "invalid_signature" ? "Invalid signature"
        : v.reason === "invalid_timestamp" ? "Timestamp expired or invalid"
        : "Unauthorized";
    }
  }

  // 2) Legacy A — HMAC `email:ts` dans le body (format Prospection historique)
  if (!authOk && ACCEPT_LEGACY_HMAC && timestamp && signature) {
    const v = verifyLegacyEmailTsHmac(secret, email, Number(timestamp), signature);
    if (v.ok) {
      authOk = true;
      authMode = "legacy_email_ts";
      console.warn(
        "[provision] legacy HMAC email:ts accepted — migrate Hub to standard {ts}.{body}",
      );
    } else {
      lastFailure = v.reason === "timestamp_drift" ? "Timestamp expired or invalid"
        : v.reason === "invalid_signature" ? "Invalid signature"
        : lastFailure;
    }
  }

  // 3) Legacy B — `Authorization: Bearer <secret>`. C'est ce que le Hub
  //    utilise aujourd'hui (regenerate-login, impersonate). Reste actif tant
  //    que la migration Hub n'est pas live.
  if (!authOk && ACCEPT_LEGACY_BEARER) {
    const v = verifyLegacyBearer(secret, request.headers.get("authorization"));
    if (v.ok) {
      authOk = true;
      authMode = "legacy_bearer";
    }
  }

  if (!authOk) {
    return NextResponse.json(
      { error: lastFailure },
      { status: 401 },
    );
  }
  // authMode disponible pour observabilité (log structuré P8).
  void authMode;

  // Token autologin one-shot (mécanisme distinct de l'api_key §6.2). Persisté
  // sur Tenant pour /api/auth/token?t=<token>.
  const loginToken = randomBytes(32).toString("hex");
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";

  console.log(`[provision] Generated token for ${email}, plan=${plan || "freemium"}`);

  // api_key §6.2 — générée et persistée (hashée) par ensureOwnerWorkspace
  // côté workspace default. Sur premier provision : on récupère le plain
  // pour le retourner au Hub. Sur replay : workspace.apiKeyHash existe déjà,
  // ensureOwnerWorkspace retourne null. Dans ce cas on retourne une clé
  // éphémère placeholder (le Hub a déjà la vraie clé en stockage). Le Hub
  // sait que sur replay sa propre copie reste valide (cf §5.1 idempotence).
  let apiKey: string;

  // Best-effort: create User + Tenant + Default workspace + admin membership.
  // Requiert `user_id` (ou `metadata.hub_user_id`) dans le body — sinon on
  // skip avec warning. Le Hub doit migrer vers le contrat v1.2 §5.1 pour
  // débloquer ce flow (cf todo/2026-05-19-hub-contract-conformity.md).
  if (hubUserId) {
    const ensured = await ensureOwnerWorkspace(hubUserId, email);
    if (ensured?.apiKey) {
      apiKey = ensured.apiKey;
    } else {
      // Replay sur workspace existant — placeholder, Hub utilise sa propre copie.
      apiKey = randomBytes(32).toString("hex");
      console.log(
        `[provision] Replay detected for ${email} — workspace already has api_key, returning placeholder`,
      );
    }

    // Persiste le token autologin sur le tenant local de cet user. Sans ça,
    // le GET /api/auth/token?t=... qui suit ne trouvera rien et redirigera
    // sur /login → user pense que sa session ne marche pas (bug observé sur
    // staging avant ce fix).
    // Lookup tenant par localUserId (peut différer de hubUserId dans le cas
    // legacy email-matched, cf helper §3.7).
    const lookupUserId = ensured?.localUserId ?? hubUserId;
    try {
      const tenant = await prisma.tenant.findFirst({
        where: { userId: lookupUserId, deletedAt: null },
        select: { id: true },
      });
      if (tenant) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            prospectionLoginToken: loginToken,
            prospectionLoginTokenCreatedAt: new Date(),
            prospectionLoginTokenUsedAt: null,
          },
        });
      } else {
        console.warn(
          `[provision] No tenant found for hub_user_id=${hubUserId} → token not persisted, autologin will fail`,
        );
      }
    } catch (err) {
      console.error(
        `[provision] Failed to persist login_token for ${email}: ${(err as Error).message}`,
      );
    }
  } else {
    console.warn(
      `[provision] No user_id in body for ${email} — skipping workspace setup. Hub must send metadata.hub_user_id (contrat v1.2).`,
    );
    // Pas de hub_user_id → pas de workspace setup → on retourne un placeholder
    // (le Hub legacy ne sait pas appeler generateMagicLink de toute façon).
    apiKey = randomBytes(32).toString("hex");
  }

  return NextResponse.json({
    tenant_id: email,
    api_key: apiKey,
    login_url: `${appUrl}/api/auth/token?t=${loginToken}`,
    plan: plan || "freemium",
    created: true,
  });
}
