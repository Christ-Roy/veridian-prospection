/**
 * POST /api/cron/mail-outbox-flush — consomme la queue mail_outbox.
 *
 * Cf migration 0028 + src/lib/mail/outbox.ts.
 *
 * Auth : Authorization: Bearer ${CRON_SECRET} (header). Aligné avec
 * `/api/cron/process-outbox` (webhooks).
 *
 * Idempotent : queue vide → 200 picked=0. Concurrence-safe : SELECT FOR
 * UPDATE SKIP LOCKED côté flushOutbox empêche tout double-envoi entre N
 * workers concurrents.
 *
 * Recommandation Dokploy Schedule : toutes les 1 min (cron `* * * * *`).
 *
 * Réponse :
 *   {
 *     ok: true,
 *     picked: 12,
 *     sent: 10,
 *     failedRetry: 1,
 *     failed: 1,
 *     duration_ms: 432
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { flushOutbox } from "@/lib/mail/outbox";

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

  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!token || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  try {
    const result = await flushOutbox();
    const duration_ms = Date.now() - start;

    if (result.picked > 0) {
      console.log(
        `[cron:mail-outbox] picked=${result.picked} sent=${result.sent} failedRetry=${result.failedRetry} failed=${result.failed} duration_ms=${duration_ms}`,
      );
    }

    return NextResponse.json({
      ok: true,
      picked: result.picked,
      sent: result.sent,
      failedRetry: result.failedRetry,
      failed: result.failed,
      duration_ms,
    });
  } catch (err) {
    console.error("[cron:mail-outbox] fatal", err);
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
