import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";

/**
 * POST /api/phone/call-log
 *
 * SIREN-centric (2026-04-05 refactor). The `domain` field in the body is kept
 * for backward compat but now carries a SIREN (9 digits).
 *
 * Two modes depending on the body shape:
 *
 * 1. INITIATION (from telnyx-provider dial):
 *    { direction, provider, from_number, to_number, domain?, siren?, status: "initiated", started_at }
 *    -> INSERT into call_log, return { ok, callId }
 *
 * 2. COMPLETION (from telnyx-provider hangup):
 *    { number, domain?, siren?, duration, answered, call_control_id? }
 *    -> UPDATE call_log + patch outreach + create followup if needed
 */

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { insertId: workspaceId } = await getWorkspaceScope();

  try {
    const body = await req.json();

    const userId = auth.user.id;
    if (body.status === "initiated") {
      return await handleInitiation(body, tenantId, workspaceId, userId);
    }
    return await handleCompletion(body, req, tenantId, workspaceId, userId);
  } catch (err) {
    console.error("[call-log] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function handleInitiation(body: {
  direction?: string;
  provider?: string;
  from_number?: string;
  to_number?: string;
  domain?: string;
  siren?: string;
  started_at?: string;
}, tenantId: string | null, workspaceId: string | null, userId: string | null) {
  const siren = body.siren ?? body.domain ?? null;
  const result = await prisma.callLog.create({
    data: {
      direction: body.direction || "outgoing",
      provider: body.provider || "telnyx",
      fromNumber: body.from_number || "+33974066175",
      toNumber: body.to_number || "",
      siren,
      status: "initiated",
      startedAt: body.started_at || new Date().toISOString(),
      tenantId,
      workspaceId,
      userId,
    },
  });

  return NextResponse.json({ ok: true, callId: Number(result.id) });
}

async function handleCompletion(
  body: {
    number?: string;
    domain?: string;
    siren?: string;
    duration?: number;
    answered?: boolean;
    call_control_id?: string;
  },
  req: NextRequest,
  tenantId: string | null,
  workspaceId: string | null,
  userId: string | null
) {
  const {
    number = "",
    duration = 0,
    answered = false,
    call_control_id,
  } = body;
  const siren = body.siren ?? body.domain ?? null;

  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const today = new Date().toISOString().split("T")[0];
  const finalStatus = answered ? "completed" : "no_answer";
  const tid = tenantId ?? null;
  const wid = workspaceId ?? null;

  let callId: number | undefined;

  if (call_control_id) {
    const existing = await prisma.callLog.findFirst({
      where: { telnyxCallControlId: call_control_id },
      select: { id: true },
    });
    if (existing) {
      await prisma.callLog.update({
        where: { id: existing.id },
        data: { status: finalStatus, endedAt: now, durationSeconds: duration },
      });
      callId = existing.id;
    }
  }

  if (!callId && number) {
    const recent = await prisma.callLog.findFirst({
      where: { toNumber: number, status: "initiated" },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    if (recent) {
      await prisma.callLog.update({
        where: { id: recent.id },
        data: { status: finalStatus, endedAt: now, durationSeconds: duration },
      });
      callId = recent.id;
    }
  }

  if (!callId) {
    const result = await prisma.callLog.create({
      data: {
        direction: "outgoing",
        provider: "telnyx",
        fromNumber: "+33974066175",
        toNumber: number,
        siren,
        status: finalStatus,
        startedAt: now,
        endedAt: now,
        durationSeconds: duration,
        telnyxCallControlId: call_control_id || null,
        tenantId,
        workspaceId,
        userId,
      },
    });
    callId = result.id;
  }

  // --- Outreach + followup logic ---
  if (siren) {
    if (answered && duration >= 30) {
      await prisma.$executeRaw`
        INSERT INTO outreach (siren, tenant_id, workspace_id, status, contact_method, contacted_date, updated_at, user_id)
        VALUES (${siren}, ${tid}::uuid, ${wid}::uuid, 'appele', 'phone', ${today}, ${now}, ${userId}::uuid)
        ON CONFLICT(siren, tenant_id) DO UPDATE SET status='appele', contact_method='phone', contacted_date=${today}, updated_at=${now}, workspace_id=COALESCE(outreach.workspace_id, EXCLUDED.workspace_id), user_id=COALESCE(EXCLUDED.user_id, outreach.user_id)
      `;
    } else if (!answered || duration < 10) {
      await prisma.$executeRaw`
        INSERT INTO outreach (siren, tenant_id, workspace_id, status, contact_method, contacted_date, updated_at, user_id)
        VALUES (${siren}, ${tid}::uuid, ${wid}::uuid, 'rappeler', 'phone', ${today}, ${now}, ${userId}::uuid)
        ON CONFLICT(siren, tenant_id) DO UPDATE SET
          status = CASE WHEN outreach.status IN ('interesse','rdv','client','contacte','appele') THEN outreach.status ELSE 'rappeler' END,
          contact_method='phone', contacted_date=${today}, updated_at=${now}, workspace_id=COALESCE(outreach.workspace_id, EXCLUDED.workspace_id), user_id=COALESCE(EXCLUDED.user_id, outreach.user_id)
      `;

      const followupDate = addBusinessDays(new Date(), 2);
      const followupAt = followupDate.toISOString().split("T")[0];
      const note = `Rappel auto -- appel du ${today} sans reponse (${duration}s)`;
      await prisma.followup.create({
        data: { siren, scheduledAt: followupAt, status: "pending", note, tenantId, workspaceId },
      });

      await prisma.claudeActivity.create({
        data: {
          siren,
          activityType: "note",
          title: "Appel sans reponse",
          content: `Appel sortant le ${today} vers ${number} -- ${answered ? `decroche ${duration}s` : "pas de reponse"}. Rappel planifie le ${followupAt}.`,
          tenantId,
          workspaceId,
          userId,
        },
      });
    } else {
      await prisma.$executeRaw`
        INSERT INTO outreach (siren, tenant_id, workspace_id, status, contact_method, contacted_date, updated_at, user_id)
        VALUES (${siren}, ${tid}::uuid, ${wid}::uuid, 'appele', 'phone', ${today}, ${now}, ${userId}::uuid)
        ON CONFLICT(siren, tenant_id) DO UPDATE SET status='appele', contact_method='phone', contacted_date=${today}, updated_at=${now}, workspace_id=COALESCE(outreach.workspace_id, EXCLUDED.workspace_id), user_id=COALESCE(EXCLUDED.user_id, outreach.user_id)
      `;
    }
  }

  // Trigger AI summary in background if answered & duration > 10s
  if (answered && duration > 10 && siren) {
    const origin =
      req.headers.get("origin") ||
      `http://localhost:${process.env.PORT || 3000}`;
    fetch(`${origin}/api/phone/summarize-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_id: Number(callId), siren, duration }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, callId: Number(callId) });
}

/** Add N business days (skip Saturday/Sunday) */
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}
