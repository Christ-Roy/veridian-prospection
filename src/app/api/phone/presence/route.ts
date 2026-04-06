import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/queries";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

/**
 * GET /api/phone/presence — current WebRTC online status
 * POST /api/phone/presence — update online/offline status
 */

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const tenantId = await getTenantId(auth.user.id);

  const online = (await getSetting("settings.webrtc_online", tenantId)) === "true";
  const lastSeen = (await getSetting("settings.webrtc_last_seen", tenantId)) ?? null;
  return NextResponse.json({ online, lastSeen });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const tenantId = await getTenantId(auth.user.id);

  try {
    const body = await req.json();
    const online = body.online === true;
    const now = new Date().toISOString();

    await setSetting("settings.webrtc_online", online ? "true" : "false", tenantId);
    await setSetting("settings.webrtc_last_seen", now, tenantId);

    return NextResponse.json({ ok: true, online });
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
}
