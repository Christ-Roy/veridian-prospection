import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

const TELNYX_API_KEY = process.env.TELNYX_API_KEY ?? "";
const TELNYX_CREDENTIAL_ID = process.env.TELNYX_CREDENTIAL_ID ?? "";

/**
 * POST /api/phone/telnyx-token
 *
 * Generates a short-lived JWT token for the Telnyx WebRTC SDK.
 * The API key never leaves the server — only the JWT is sent to the browser.
 */
export async function POST() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  // TODO: pass tenantId when query supports it
  await getTenantId(auth.user.id);

  if (!TELNYX_API_KEY || !TELNYX_CREDENTIAL_ID) {
    return NextResponse.json(
      { error: "Telnyx credentials not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.telnyx.com/v2/telephony_credentials/${TELNYX_CREDENTIAL_ID}/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TELNYX_API_KEY}`,
        },
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error("[telnyx-token] Token generation failed:", res.status, body);
      return NextResponse.json(
        { error: "Token generation failed", detail: body },
        { status: res.status }
      );
    }

    // Telnyx returns the JWT as plain text
    const token = await res.text();

    return NextResponse.json({ token });
  } catch (err) {
    console.error("[telnyx-token] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
