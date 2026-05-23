/**
 * Public API — Accept an invitation (Auth.js v5, depuis migration 2026-05-23).
 *
 * POST /api/invitations/[token]/accept
 *   body: { password: string (>= 8), fullName?: string }
 *   → 200 { userId: string, email: string, redirectTo: '/prospects' }
 *     → le client ouvre ensuite la session via signIn("credentials") côté React
 *   → 404 { error } si invitation expirée / inconnue
 *   → 400 { error } si payload invalide
 *   → 429 { error } sur rate limit
 *
 * Rate limit : 10 requests / minute / client IP.
 * No auth required — le token dans le path est le credential.
 */
import { NextRequest, NextResponse } from "next/server";
import { acceptInvitation } from "@/lib/invitations";
import { isRateLimited } from "@/lib/rate-limit";

function getClientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(request);
  if (isRateLimited(`invite-accept:${ip}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "Too many requests, slow down" },
      { status: 429 },
    );
  }

  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  const password: string = body?.password ?? "";
  const fullName: string | undefined =
    typeof body?.fullName === "string" && body.fullName.trim() ? body.fullName.trim() : undefined;

  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400 },
    );
  }

  try {
    const result = await acceptInvitation({ token, password, fullName });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "failed to accept invitation";
    console.error("[POST /api/invitations/:token/accept] error:", msg);
    const status = /invalid or expired/i.test(msg) ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
