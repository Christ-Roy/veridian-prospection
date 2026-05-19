import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { verifyHubHmac, verifyLegacyEmailTsHmac } from "@/lib/hub/hmac";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function getSecret(): string | undefined {
  return process.env.HUB_API_SECRET || process.env.TENANT_API_SECRET;
}

const ACCEPT_LEGACY_HMAC = process.env.ACCEPT_LEGACY_HMAC !== "0";

/**
 * POST /api/tenants/e2e-cleanup
 *
 * Deletes throwaway e2e test users (emails matching `e2e-<timestamp>@yopmail.com`
 * created more than `olderThanHours` hours ago) from Supabase auth.users plus
 * their tenants/workspaces cascade. Safe because the email pattern is
 * structurally distinct from real signup users (no timestamp prefix).
 *
 * Auth: HMAC-signed request (same pattern as /api/tenants/provision).
 * Never deletes e2e-persistent@yopmail.com or any non-matching email.
 *
 * Typical use: scheduled GitHub Action cron on staging (daily).
 */
export async function POST(request: NextRequest) {
  const secret = getSecret();
  if (!secret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const rawBody = await request.text();
  let body: {
    timestamp?: number;
    signature?: string;
    olderThanHours?: number;
    dryRun?: boolean;
  };
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const { timestamp, signature, olderThanHours = 24, dryRun = false } = body;

  // Pattern A — HMAC standard contrat §6.1
  const headerSig = request.headers.get("x-veridian-hub-signature");
  const headerTs = Number(request.headers.get("x-veridian-timestamp"));

  let authOk = false;
  let lastFailure = "Unauthorized";

  if (headerSig) {
    const v = verifyHubHmac(secret, headerTs, rawBody, headerSig);
    if (v.ok) authOk = true;
    else if (v.reason === "timestamp_drift" || v.reason === "invalid_timestamp") {
      lastFailure = "Timestamp expired or invalid";
    } else if (v.reason === "invalid_signature") {
      lastFailure = "Invalid signature";
    }
  }

  // Legacy — HMAC `e2e-cleanup:ts` dans le body
  if (!authOk && ACCEPT_LEGACY_HMAC && timestamp && signature) {
    const v = verifyLegacyEmailTsHmac(secret, "e2e-cleanup", Number(timestamp), signature);
    if (v.ok) {
      authOk = true;
      console.warn("[e2e-cleanup] legacy HMAC payload:ts accepted");
    } else if (v.reason === "timestamp_drift" || v.reason === "invalid_timestamp") {
      lastFailure = "Timestamp expired or invalid";
    } else if (v.reason === "invalid_signature") {
      lastFailure = "Invalid signature";
    }
  }

  if (!authOk) {
    return NextResponse.json({ error: lastFailure }, { status: 401 });
  }

  const supaUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase admin unavailable" }, { status: 500 });
  }
  const admin = createSupabaseAdmin(supaUrl, serviceKey);

  const cutoffMs = Date.now() - olderThanHours * 60 * 60 * 1000;
  // Match e2e-<14-digit-timestamp>@yopmail.com and e2e-<anything>@yopmail.com
  // except the protected persistent user.
  const throwawayRe = /^e2e-\d{10,}@yopmail\.com$/i;
  const PROTECTED = new Set(["e2e-persistent@yopmail.com"]);

  const toDelete: { id: string; email: string }[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const users = data?.users ?? [];
    for (const u of users) {
      const email = (u.email ?? "").toLowerCase();
      if (!throwawayRe.test(email)) continue;
      if (PROTECTED.has(email)) continue;
      const createdMs = u.created_at ? new Date(u.created_at).getTime() : 0;
      if (createdMs > cutoffMs) continue;
      toDelete.push({ id: u.id, email });
    }
    if (users.length < 1000) break;
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      olderThanHours,
      wouldDelete: toDelete.length,
      sample: toDelete.slice(0, 5).map((u) => u.email),
    });
  }

  let deleted = 0;
  const errors: string[] = [];
  for (const u of toDelete) {
    try {
      // Delete tenant cascade first (ON DELETE CASCADE on workspace_members + workspaces)
      await admin.from("tenants").delete().eq("user_id", u.id);
      // Also delete any workspaces/members on the prospection side
      await prisma.workspaceMember.deleteMany({ where: { userId: u.id } }).catch(() => {});
      // Finally delete the auth.users row (cascades on auth-managed tables)
      const { error } = await admin.auth.admin.deleteUser(u.id);
      if (error) {
        errors.push(`${u.email}: ${error.message}`);
      } else {
        deleted++;
      }
    } catch (err) {
      errors.push(`${u.email}: ${(err as Error).message}`);
    }
  }

  return NextResponse.json({
    olderThanHours,
    scanned: toDelete.length,
    deleted,
    errors: errors.slice(0, 10),
    errorCount: errors.length,
  });
}
