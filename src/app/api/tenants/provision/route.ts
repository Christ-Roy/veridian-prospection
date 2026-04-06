import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { PrismaClient } from "@prisma/client";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function getSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseAdmin(url, key);
}

/**
 * Ensure a freshly provisioned tenant has:
 *   - a "Default" workspace (slug=default)
 *   - the owner user assigned as admin of that workspace
 *
 * Safe to call multiple times — idempotent. Logs and swallows errors so a
 * provisioning flow never breaks on membership setup.
 */
async function ensureOwnerAdmin(email: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    console.warn("[provision] Supabase admin unavailable, skipping auto-admin");
    return;
  }

  // 1) Résoudre user_id Supabase par email
  let userId: string | null = null;
  try {
    // Supabase JS n'expose pas getUserByEmail → on liste et on filtre (OK pour petits tenants)
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const user = data?.users?.find(
      (u) => (u.email ?? "").toLowerCase() === email.toLowerCase()
    );
    if (user) userId = user.id;
  } catch (err) {
    console.warn(`[provision] listUsers failed: ${(err as Error).message}`);
    return;
  }
  if (!userId) {
    console.warn(`[provision] No Supabase user yet for ${email} — skipping auto-admin`);
    return;
  }

  // 2) Résoudre tenant_id via public.tenants.user_id
  let tenantId: string | null = null;
  try {
    const { data: tenant } = await admin
      .from("tenants")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (tenant?.id) tenantId = tenant.id;
  } catch (err) {
    console.warn(`[provision] tenant lookup failed: ${(err as Error).message}`);
    return;
  }
  if (!tenantId) {
    console.warn(`[provision] No tenant row yet for user ${userId} — auto-admin skipped`);
    return;
  }

  // 3) Workspace "default" upsert
  try {
    let workspace = await prisma.workspace.findFirst({
      where: { tenantId, slug: "default" },
      select: { id: true },
    });
    if (!workspace) {
      workspace = await prisma.workspace.create({
        data: {
          tenantId,
          name: "Default",
          slug: "default",
          createdBy: userId,
        },
        select: { id: true },
      });
    }

    // 4) Membership admin upsert
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
      `[provision] Auto-admin OK: user=${userId} tenant=${tenantId} workspace=${workspace.id}`
    );
  } catch (err) {
    console.error(`[provision] auto-admin upsert failed: ${(err as Error).message}`);
  }
}

const TENANT_API_SECRET = process.env.TENANT_API_SECRET;
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

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

function verifyHmac(email: string, timestamp: number, signature: string): boolean {
  if (!TENANT_API_SECRET) return false;
  const expected = createHmac("sha256", TENANT_API_SECRET)
    .update(`${email}:${timestamp}`)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  // Rate limit
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await request.json();
  const { email, plan, timestamp, signature } = body;

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  if (!TENANT_API_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // Auth: HMAC signature (preferred) or legacy Bearer token (backward compat)
  if (timestamp && signature) {
    // HMAC auth: verify signature and timestamp freshness
    const ts = Number(timestamp);
    if (isNaN(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
      return NextResponse.json({ error: "Timestamp expired or invalid" }, { status: 401 });
    }
    if (!verifyHmac(email, ts, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else {
    // Legacy Bearer token (backward compat — will be removed)
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${TENANT_API_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Generate fresh credentials. The hub (regenerate-login) is responsible
  // for persisting these in the Supabase tenants table.
  const apiKey = randomBytes(32).toString("hex");
  const loginToken = randomBytes(32).toString("hex");
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";

  console.log(`[provision] Generated token for ${email}, plan=${plan || "freemium"}`);

  // Best-effort auto-admin: create Default workspace + admin membership for the
  // tenant owner. Non-blocking — if the user/tenant isn't fully materialized
  // yet on the Supabase side, the backfill script will catch it.
  await ensureOwnerAdmin(email);

  return NextResponse.json({
    tenant_id: email,
    api_key: apiKey,
    login_url: `${appUrl}/api/auth/token?t=${loginToken}`,
    plan: plan || "freemium",
    created: true,
  });
}
