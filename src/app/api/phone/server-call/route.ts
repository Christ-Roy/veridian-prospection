import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";

/**
 * Server-side Click2Call via Telnyx Call Control API
 *
 * POST /api/phone/server-call { number, domain? }
 * GET  /api/phone/server-call -> status check
 * DELETE /api/phone/server-call -> hangup all (not applicable for Telnyx WebRTC)
 */

const TELNYX_API_KEY = process.env.TELNYX_API_KEY ?? "";
// Call Control App ID (for server-side calls) -- NOT the Credential Connection
const TELNYX_CALL_CONTROL_APP_ID = process.env.TELNYX_CALL_CONTROL_APP_ID ?? process.env.TELNYX_CONNECTION_ID ?? "";
const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER ?? "+33974066175";

function normalizeToE164(number: string): string {
  // SIP URIs pass through unchanged
  if (number.startsWith("sip:") || number.startsWith("sips:")) return number;
  let n = number.replace(/[\s.\-()]/g, "");
  if (n.startsWith("0") && !n.startsWith("00")) {
    n = "+33" + n.slice(1);
  } else if (n.startsWith("0033")) {
    n = "+" + n.slice(2);
  } else if (n.startsWith("33") && !n.startsWith("+")) {
    n = "+" + n;
  } else if (!n.startsWith("+")) {
    n = "+" + n;
  }
  return n;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { insertId: workspaceId } = await getWorkspaceScope();
  const body = await req.json();
  const { number } = body;
  // SIREN carried in `siren` or legacy `domain` field
  const siren: string | null = body.siren ?? body.domain ?? null;
  if (!number) return NextResponse.json({ error: "Missing number" }, { status: 400 });

  if (!TELNYX_API_KEY) {
    return NextResponse.json({ error: "Telnyx API key not configured" }, { status: 500 });
  }

  const e164 = normalizeToE164(number);
  const local = number.replace(/[\s.\-()]/g, "");
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const tid = tenantId ?? null;
  const wid = workspaceId ?? null;
  const uid = auth.user.id;

  // Log call
  const result = await prisma.callLog.create({
    data: {
      direction: "outgoing",
      provider: "telnyx",
      fromNumber: TELNYX_PHONE_NUMBER,
      toNumber: local,
      siren,
      status: "initiated",
      startedAt: now,
      tenantId,
      workspaceId,
      userId: uid,
    },
  });
  const callId = result.id;

  // Make call via Telnyx Call Control API
  try {
    const telnyxRes = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connection_id: TELNYX_CALL_CONTROL_APP_ID,
        to: e164,
        from: TELNYX_PHONE_NUMBER,
        from_display_name: "Veridian",
        record: "record-from-answer",
        record_format: "mp3",
      }),
    });

    if (!telnyxRes.ok) {
      const errBody = await telnyxRes.text();
      console.error("[server-call] Telnyx API error:", telnyxRes.status, errBody);
      await prisma.callLog.update({ where: { id: callId }, data: { status: "failed" } });
      return NextResponse.json(
        { error: "Telnyx call failed", detail: errBody },
        { status: telnyxRes.status }
      );
    }

    const telnyxData = await telnyxRes.json();
    const callControlId = telnyxData.data?.call_control_id;

    // Update call log with Telnyx call_control_id
    await prisma.callLog.update({
      where: { id: callId },
      data: { telnyxCallControlId: callControlId || null },
    });

    // Track destination (ovh_monthly_destinations kept as legacy table — not in Prisma schema)
    const month = new Date().toISOString().slice(0, 7);
    await prisma.$executeRaw`
      INSERT INTO ovh_monthly_destinations (month, destination, first_called_at)
      VALUES (${month}, ${local}, ${now})
      ON CONFLICT(month, destination) DO UPDATE SET call_count = ovh_monthly_destinations.call_count + 1
    `;

    // Auto-update outreach status
    if (siren) {
      const today = new Date().toISOString().split("T")[0];
      await prisma.$executeRaw`
        INSERT INTO outreach (siren, tenant_id, workspace_id, status, contact_method, contacted_date, updated_at, user_id)
        VALUES (${siren}, ${tid}::uuid, ${wid}::uuid, 'appele', 'phone', ${today}, ${now}, ${uid}::uuid)
        ON CONFLICT(siren, tenant_id) DO UPDATE SET status='appele', contact_method='phone', contacted_date=${today}, updated_at=${now}, workspace_id=COALESCE(outreach.workspace_id, EXCLUDED.workspace_id), user_id=COALESCE(EXCLUDED.user_id, outreach.user_id)
      `;
    }

    return NextResponse.json({
      ok: true,
      callId,
      callControlId,
      message: "Appel lance via Telnyx.",
    });
  } catch (err) {
    await prisma.callLog.update({ where: { id: callId }, data: { status: "failed" } });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  // Simple health check
  return NextResponse.json({
    provider: "telnyx",
    status: TELNYX_API_KEY ? "configured" : "missing_api_key",
    phone_number: TELNYX_PHONE_NUMBER,
  });
}

export async function DELETE() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  return NextResponse.json({ ok: true, message: "Use client-side hangup for WebRTC calls" });
}
