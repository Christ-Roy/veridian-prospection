import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const TENANT_API_SECRET = process.env.TENANT_API_SECRET;
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;

function verifyHmac(payload: string, timestamp: number, signature: string): boolean {
  if (!TENANT_API_SECRET) return false;
  const expected = createHmac("sha256", TENANT_API_SECRET)
    .update(`${payload}:${timestamp}`)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

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
  const body = (await request.json().catch(() => ({}))) as {
    timestamp?: number;
    signature?: string;
    olderThanHours?: number;
    dryRun?: boolean;
  };

  const { timestamp, signature, olderThanHours = 24, dryRun = false } = body;

  if (!TENANT_API_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // HMAC auth
  const ts = Number(timestamp);
  if (!timestamp || !signature || isNaN(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
    return NextResponse.json({ error: "Timestamp expired or invalid" }, { status: 401 });
  }
  if (!verifyHmac("e2e-cleanup", ts, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
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
