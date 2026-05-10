import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";

const TENANT_API_SECRET = process.env.TENANT_API_SECRET;
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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
 * POST /api/tenants/magic-link
 *
 * Rotates the prospection_login_token for an existing tenant and returns a
 * fresh login_url. Idempotent — each call overwrites the previous token, so
 * the previous URL becomes invalid. Pure rotation, no provisioning side-effect.
 *
 * Use case: the Hub's "Open Prospection" button calls this on every click so
 * the user always gets a fresh 24h token, even months after signup. Avoids the
 * heavy provision flow (listUsers pagination, ensureOwnerAdmin, tenant insert).
 *
 * Auth: HMAC-SHA256 — same pattern as /api/tenants/provision and
 * /api/tenants/e2e-cleanup. Body must include `timestamp` (ms) and `signature`
 * (hex of HMAC over `${tenant_id}:${timestamp}`). Drift max 5 min.
 *
 * Body:
 *   { tenant_id: "owner-email@x.com", timestamp: 1731000000000, signature: "..." }
 *
 * The `tenant_id` is the owner email (matches what /api/tenants/provision
 * returns to the Hub as `tenant_id`). We resolve email → auth.users.id →
 * tenants.user_id internally.
 *
 * Response:
 *   200 { login_url: "<APP_URL>/api/auth/token?t=<token>", expires_at: "<ISO>" }
 *   401 invalid HMAC / drift expired
 *   404 tenant not found
 *   500 server misconfigured
 */
export async function POST(request: NextRequest) {
  if (!TENANT_API_SECRET) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    tenant_id?: string;
    timestamp?: number;
    signature?: string;
  };

  const { tenant_id: tenantId, timestamp, signature } = body;

  if (!tenantId || typeof tenantId !== "string") {
    return NextResponse.json({ error: "tenant_id required" }, { status: 400 });
  }

  const ts = Number(timestamp);
  if (!timestamp || !signature || isNaN(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
    return NextResponse.json({ error: "Timestamp expired or invalid" }, { status: 401 });
  }
  if (!verifyHmac(tenantId, ts, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const supaUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase admin unavailable" }, { status: 500 });
  }
  const admin = createSupabaseAdmin(supaUrl, serviceKey);

  // Resolve email → auth.users.id → tenants row.
  // The tenant_id contract with the Hub is the owner email (see
  // /api/tenants/provision response shape: { tenant_id: email }).
  const target = tenantId.toLowerCase();
  let userId: string | null = null;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const user = data?.users?.find((u) => (u.email ?? "").toLowerCase() === target);
    if (user) {
      userId = user.id;
      break;
    }
    if (!data?.users || data.users.length < 1000) break;
  }
  if (!userId) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (tenantErr) {
    return NextResponse.json({ error: tenantErr.message }, { status: 500 });
  }
  if (!tenant?.id) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const loginToken = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);

  const { error: updateErr } = await admin
    .from("tenants")
    .update({
      prospection_login_token: loginToken,
      prospection_login_token_created_at: now.toISOString(),
      prospection_login_token_used: false,
    })
    .eq("id", tenant.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
  console.log(`[magic-link] Rotated token for tenant ${tenant.id} (${target})`);

  return NextResponse.json({
    login_url: `${appUrl}/api/auth/token?t=${loginToken}`,
    expires_at: expiresAt.toISOString(),
  });
}
