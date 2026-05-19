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
            // status='appele' ↔ pipeline_stage='repondeur' (mapping canonique
            // cf src/lib/outreach/status.ts). Anti-régression : si le lead
            // est déjà en site_demo/acompte/finition/client/upsell, on
            // préserve son état avancé.
            await prisma.$executeRaw`
              INSERT INTO outreach (siren, tenant_id, workspace_id, status, pipeline_stage, contact_method, contacted_date, updated_at, last_interaction_at)
              VALUES (${row.siren}, ${tid}::uuid, ${wid}::uuid, 'appele', 'repondeur', 'phone', ${today}, ${now}, NOW())
              ON CONFLICT(siren, tenant_id) DO UPDATE SET
                status = CASE WHEN outreach.pipeline_stage IN ('site_demo','acompte','finition','client','upsell') THEN outreach.status ELSE 'appele' END,
                pipeline_stage = CASE WHEN outreach.pipeline_stage IN ('site_demo','acompte','finition','client','upsell') THEN outreach.pipeline_stage ELSE 'repondeur' END,
                contact_method='phone', contacted_date=${today}, updated_at=${now}, last_interaction_at=NOW(),
                workspace_id=COALESCE(outreach.workspace_id, EXCLUDED.workspace_id)
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
            // status='rappeler' ↔ pipeline_stage='a_rappeler'. Anti-régression
            // étendue à interesse/rdv/client/contacte (legacy) + stages avancés.
            await prisma.$executeRaw`
              INSERT INTO outreach (siren, tenant_id, workspace_id, status, pipeline_stage, updated_at, last_interaction_at)
              VALUES (${row.siren}, ${tidHangup}::uuid, ${widHangup}::uuid, 'rappeler', 'a_rappeler', ${now}, NOW())
              ON CONFLICT(siren, tenant_id) DO UPDATE SET
                status = CASE WHEN outreach.status IN ('interesse','rdv','client','contacte') OR outreach.pipeline_stage IN ('site_demo','acompte','finition','client','upsell') THEN outreach.status ELSE 'rappeler' END,
                pipeline_stage = CASE WHEN outreach.pipeline_stage IN ('site_demo','acompte','finition','client','upsell') THEN outreach.pipeline_stage ELSE 'a_rappeler' END,
                updated_at = ${now}, last_interaction_at = NOW(),
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
          // Répondeur détecté : status='rappeler' + pipeline_stage='a_rappeler'
          // (équivalent fonctionnel — il faut rappeler plus tard).
          await prisma.$executeRaw`
            INSERT INTO outreach (siren, tenant_id, workspace_id, status, pipeline_stage, contact_method, contacted_date, updated_at, last_interaction_at)
            VALUES (${row.siren}, ${tidMachine}::uuid, ${widMachine}::uuid, 'rappeler', 'a_rappeler', 'phone', ${today}, ${now}, NOW())
            ON CONFLICT(siren, tenant_id) DO UPDATE SET
              status = CASE WHEN outreach.status IN ('interesse','rdv','client','contacte') OR outreach.pipeline_stage IN ('site_demo','acompte','finition','client','upsell') THEN outreach.status ELSE 'rappeler' END,
              pipeline_stage = CASE WHEN outreach.pipeline_stage IN ('site_demo','acompte','finition','client','upsell') THEN outreach.pipeline_stage ELSE 'a_rappeler' END,
              contact_method='phone', contacted_date=${today}, updated_at=${now}, last_interaction_at=NOW(),
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
