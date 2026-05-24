/**
 * POST /api/cron/process-outbox — consomme la queue webhook_outbox.
 *
 * Cf migration 0023 + src/lib/hub-webhook/outbox.ts.
 *
 * Auth : `Authorization: Bearer ${CRON_SECRET}` (header). Pattern Bearer
 * volontairement différent de l'autre cron `/api/cron/check-reminders` qui
 * utilise `?secret=` en query — header Bearer est plus propre et c'est le
 * standard Dokploy Schedule Jobs (qui peut passer un Authorization custom).
 *
 * Idempotent : si la queue est vide, retourne 200 picked=0. Si plusieurs
 * appels concurrents tombent en même temps, le SELECT FOR UPDATE SKIP LOCKED
 * côté `processOutbox` évite tout double-envoi.
 *
 * Réponse :
 *   {
 *     "ok": true,
 *     "picked": 12,
 *     "sent": 10,
 *     "failed": 2,
 *     "dead": 0,
 *     "duration_ms": 432
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { processOutbox } from "@/lib/hub-webhook/outbox";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return NextResponse.json(
      { error: "cron_secret_not_configured" },
      { status: 503 },
    );
  }

  // Bearer scheme, tolère casse (some proxies lowercase).
  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!token || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    const result = await processOutbox();
    const duration_ms = Date.now() - start;

    if (result.picked > 0) {
      console.log(
        `[cron:outbox] picked=${result.picked} sent=${result.sent} failed=${result.failed} dead=${result.dead} duration_ms=${duration_ms}`,
      );
    }

    return NextResponse.json({
      ok: true,
      picked: result.picked,
      sent: result.sent,
      failed: result.failed,
      dead: result.dead,
      duration_ms,
    });
  } catch (err) {
    console.error("[cron:outbox] fatal", err);
    return NextResponse.json(
      {
        ok: false,
        error: "processing_failed",
        message: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
