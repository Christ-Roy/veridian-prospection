import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");

  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const baseUrl = `${proto}://${host}`;

  console.log(`[auth/token] Validating token, host=${host}, supabaseUrl=${supabaseUrl ? "set" : "unset"}`);

  // Validate token against Supabase tenants table
  if (supabaseUrl && supabaseServiceKey) {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: tenant, error } = await supabase
      .from("tenants")
      .select("id, prospection_login_token_created_at, prospection_login_token_used")
      .eq("prospection_login_token", token)
      .maybeSingle();

    if (error || !tenant) {
      console.warn(`[auth/token] Token lookup failed: ${error?.message || "no tenant found"}, token prefix=${token.slice(0, 8)}...`);
      return NextResponse.redirect(new URL("/login?error=invalid_token", baseUrl));
    }

    console.log(`[auth/token] Token found for tenant ${tenant.id}, used=${tenant.prospection_login_token_used}`);

    // Reject already-used tokens
    if (tenant.prospection_login_token_used) {
      console.warn(`[auth/token] Token already used for tenant ${tenant.id}`);
      return NextResponse.redirect(new URL("/login?error=token_used", baseUrl));
    }

    // Check token age (24h max)
    if (tenant.prospection_login_token_created_at) {
      const createdAt = new Date(tenant.prospection_login_token_created_at).getTime();
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      if (now - createdAt > maxAge) {
        console.warn(`[auth/token] Token expired for tenant ${tenant.id}, age=${Math.round((now - createdAt) / 3600000)}h`);
        return NextResponse.redirect(new URL("/login?error=token_expired", baseUrl));
      }
    }

    // Mark token as used
    await supabase
      .from("tenants")
      .update({ prospection_login_token_used: true })
      .eq("id", tenant.id);

    console.log(`[auth/token] Token validated and marked used for tenant ${tenant.id}`);
  } else {
    console.warn("[auth/token] Supabase not configured — skipping token validation");
  }

  return NextResponse.redirect(new URL("/", baseUrl));
}
