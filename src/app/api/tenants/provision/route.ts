import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import {
  verifyHubHmac,
  verifyLegacyEmailTsHmac,
  verifyLegacyBearer,
} from "@/lib/hub/hmac";

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
 * Best-effort : on log et on swallow les erreurs pour ne pas casser le flow
 * de provisioning principal (le Hub considère succès dès qu'on a renvoyé
 * api_key + login_url).
 */
async function ensureOwnerWorkspace(userId: string, email: string): Promise<void> {
  try {
    await prisma.user.upsert({
      where: { id: userId },
      update: { email },
      create: { id: userId, email, supabaseUserId: userId },
    });

    const slugBase = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "tenant";

    let tenant = await prisma.tenant.findFirst({
      where: { userId },
      select: { id: true },
    });

    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          userId,
          name: `${email.split("@")[0]}'s Workspace`,
          slug: `${slugBase}-${Date.now().toString(36)}`,
          status: "active",
        },
        select: { id: true },
      });
    }

    let workspace = await prisma.workspace.findFirst({
      where: { tenantId: tenant.id, slug: "default" },
      select: { id: true },
    });
    if (!workspace) {
      workspace = await prisma.workspace.create({
        data: {
          tenantId: tenant.id,
          name: "Default",
          slug: "default",
          createdBy: userId,
        },
        select: { id: true },
      });
    }

    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
      update: { role: "admin" },
      create: {
        workspaceId: workspace.id,
        userId,
        role: "admin",
        visibilityScope: "all",
      },
    });

    console.log(
      `[provision] Auto-admin OK: user=${userId} tenant=${tenant.id} workspace=${workspace.id}`,
    );
  } catch (err) {
    console.error(`[provision] auto-admin upsert failed for ${email}: ${(err as Error).message}`);
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

  // Generate fresh credentials. The hub (regenerate-login) is responsible
  // for persisting these in the Supabase tenants table.
  const apiKey = randomBytes(32).toString("hex");
  const loginToken = randomBytes(32).toString("hex");
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";

  console.log(`[provision] Generated token for ${email}, plan=${plan || "freemium"}`);

  // Best-effort: create User + Tenant + Default workspace + admin membership.
  // Requiert `user_id` (ou `metadata.hub_user_id`) dans le body — sinon on
  // skip avec warning. Le Hub doit migrer vers le contrat v1.2 §5.1 pour
  // débloquer ce flow (cf todo/2026-05-19-hub-contract-conformity.md).
  if (hubUserId) {
    await ensureOwnerWorkspace(hubUserId, email);
  } else {
    console.warn(
      `[provision] No user_id in body for ${email} — skipping workspace setup. Hub must send metadata.hub_user_id (contrat v1.2).`,
    );
  }

  return NextResponse.json({
    tenant_id: email,
    api_key: apiKey,
    login_url: `${appUrl}/api/auth/token?t=${loginToken}`,
    plan: plan || "freemium",
    created: true,
  });
}
