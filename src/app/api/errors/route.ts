import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/errors — client-side error reporting endpoint.
 * Rate-limited to 10 reports per minute per IP.
 */

const recentErrors = new Map<string, number>();

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const now = Date.now();
  const key = `${ip}-${Math.floor(now / 60000)}`;
  const count = recentErrors.get(key) ?? 0;
  if (count >= 10) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }
  recentErrors.set(key, count + 1);

  // Cleanup old entries
  for (const [k] of recentErrors) {
    if (!k.endsWith(`-${Math.floor(now / 60000)}`)) recentErrors.delete(k);
  }

  try {
    const body = await request.json();
    const { message, stack, url, userAgent } = body as {
      message?: string; stack?: string; url?: string; userAgent?: string;
    };

    console.error(`[client-error] ${message}`, {
      stack: stack?.slice(0, 500),
      url,
      userAgent: userAgent?.slice(0, 200),
      ip,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
