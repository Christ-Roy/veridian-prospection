import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleIncomingCall } from "./incoming-handler";

/**
 * POST /api/phone/telnyx-webhook
 * Receives Telnyx Call Control webhook events.
 * 2026-04-05: Refactored to SIREN-centric. The `siren` column on call_log/outreach/
 * followups/claude_activity replaces the legacy `domain` column.
 */

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    const event = payload?.data;
    if (!event) {
      return NextResponse.json({ ok: true });
    }

    const eventType: string = event.event_type ?? "";
    const ep = event.payload ?? {};
    const callControlId: string | undefined = ep.call_control_id;

    if (!callControlId) {
      return NextResponse.json({ ok: true });
    }

    const now = new Date().toISOString().replace("T", " ").split(".")[0];
    const today = new Date().toISOString().split("T")[0];

    // Find existing call_log row
    const row = await prisma.callLog.findFirst({
      where: { telnyxCallControlId: callControlId },
      select: { id: true, siren: true, startedAt: true, status: true, tenantId: true, workspaceId: true },
    });

    switch (eventType) {
      case "call.initiated": {
        const direction: string = ep.direction ?? "";
        if (direction === "incoming") {
          const callerNumber: string = ep.from ?? ep.caller_id_number ?? "Inconnu";
          handleIncomingCall(callControlId, callerNumber).catch((err) =>
            console.error("[telnyx-webhook] incoming handler error:", err)
          );
        }
        break;
      }

      case "call.answered": {
        if (row) {
          await prisma.callLog.update({
            where: { id: row.id },
            data: { status: "answered" },
          });

          if (row.siren) {
            const tid = row.tenantId ?? "00000000-0000-0000-0000-000000000000";
            const wid = row.workspaceId ?? null;
            await prisma.$executeRaw`
              INSERT INTO outreach (siren, tenant_id, workspace_id, status, contact_method, contacted_date, updated_at)
              VALUES (${row.siren}, ${tid}::uuid, ${wid}::uuid, 'appele', 'phone', ${today}, ${now})
              ON CONFLICT(siren, tenant_id) DO UPDATE SET status='appele', contact_method='phone', contacted_date=${today}, updated_at=${now}, workspace_id=COALESCE(outreach.workspace_id, EXCLUDED.workspace_id)
            `;
          }
        }
        break;
      }

      case "call.hangup": {
        if (row) {
          const startedAt = new Date(String(row.startedAt).replace(" ", "T") + "Z");
          const duration = Math.floor((Date.now() - startedAt.getTime()) / 1000);

          await prisma.callLog.update({
            where: { id: row.id },
            data: { status: "completed", endedAt: now, durationSeconds: duration },
          });

          if (duration < 10 && row.siren) {
            const followupDate = addBusinessDays(new Date(), 2);
            const followupAt = followupDate.toISOString().split("T")[0];
            await prisma.followup.create({
              data: {
                siren: row.siren,
                scheduledAt: followupAt,
                status: "pending",
                note: `Rappel auto -- appel du ${today} trop court (${duration}s)`,
                tenantId: row.tenantId,
                workspaceId: row.workspaceId,
              },
            });

            const tidHangup = row.tenantId ?? "00000000-0000-0000-0000-000000000000";
            const widHangup = row.workspaceId ?? null;
            await prisma.$executeRaw`
              INSERT INTO outreach (siren, tenant_id, workspace_id, status, updated_at)
              VALUES (${row.siren}, ${tidHangup}::uuid, ${widHangup}::uuid, 'rappeler', ${now})
              ON CONFLICT(siren, tenant_id) DO UPDATE SET
                status = CASE WHEN outreach.status IN ('interesse','rdv','client','contacte') THEN outreach.status ELSE 'rappeler' END,
                updated_at = ${now},
                workspace_id = COALESCE(outreach.workspace_id, EXCLUDED.workspace_id)
            `;
          }
        }
        break;
      }

      case "call.recording.saved": {
        const recordingUrl: string | undefined =
          ep.recording_urls?.mp3 ?? ep.public_recording_urls?.mp3 ?? null;

        if (row && recordingUrl) {
          await prisma.callLog.update({
            where: { id: row.id },
            data: { recordingPath: recordingUrl },
          });
        }

        // Trigger AI summary if we have a siren
        if (row?.siren) {
          const origin =
            req.headers.get("origin") ??
            `http://localhost:${process.env.PORT || 3000}`;
          fetch(`${origin}/api/phone/summarize-call`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              call_id: row.id,
              siren: row.siren,
              recording_url: recordingUrl,
            }),
          }).catch(() => {});
        }
        break;
      }

      case "call.machine.detection.ended": {
        const result: string = ep.result ?? "";
        if (row && result === "machine" && row.siren) {
          await prisma.callLog.update({
            where: { id: row.id },
            data: { status: "voicemail", notes: "Repondeur detecte" },
          });

          const tidMachine = row.tenantId ?? "00000000-0000-0000-0000-000000000000";
          const widMachine = row.workspaceId ?? null;
          await prisma.$executeRaw`
            INSERT INTO outreach (siren, tenant_id, workspace_id, status, contact_method, contacted_date, updated_at)
            VALUES (${row.siren}, ${tidMachine}::uuid, ${widMachine}::uuid, 'rappeler', 'phone', ${today}, ${now})
            ON CONFLICT(siren, tenant_id) DO UPDATE SET
              status = CASE WHEN outreach.status IN ('interesse','rdv','client','contacte') THEN outreach.status ELSE 'rappeler' END,
              contact_method='phone', contacted_date=${today}, updated_at=${now},
              workspace_id = COALESCE(outreach.workspace_id, EXCLUDED.workspace_id)
          `;

          const followupDate = addBusinessDays(new Date(), 2);
          const followupAt = followupDate.toISOString().split("T")[0];
          await prisma.followup.create({
            data: {
              siren: row.siren,
              scheduledAt: followupAt,
              status: "pending",
              note: `Rappel auto -- repondeur detecte le ${today}`,
              tenantId: row.tenantId,
              workspaceId: row.workspaceId,
            },
          });

          await prisma.claudeActivity.create({
            data: {
              siren: row.siren,
              activityType: "note",
              title: "Repondeur detecte",
              content: `Appel sortant du ${today} : repondeur. Followup rappel cree pour le ${followupAt}.`,
              tenantId: row.tenantId,
              workspaceId: row.workspaceId,
            },
          });
        }
        break;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[telnyx-webhook] Error:", err);
    return NextResponse.json({ ok: false, error: String(err) });
  }
}

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
