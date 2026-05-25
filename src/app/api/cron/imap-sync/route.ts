/**
 * POST /api/cron/imap-sync — déclencheur du cron IMAP (5 min systemd).
 *
 * Auth : `Authorization: Bearer ${CRON_SECRET}` (header). Même pattern que
 * /api/cron/process-outbox.
 *
 * Idempotent côté DB grâce à message_id UNIQUE — concurrent runs ne
 * double-insèrent pas.
 *
 * Réponse :
 *   {
 *     "ok": true,
 *     "totalTenants": 3,
 *     "okTenants": 2,
 *     "failedTenants": 1,
 *     "totalInserted": 7,
 *     "duration_ms": 4321,
 *     "perTenant": [...]
 *   }
 *
 * Documentation déploiement : docs/CRON-IMAP-SYNC.md.
 */
import { NextRequest, NextResponse } from "next/server";
import { runImapSync } from "@/lib/mail/imap-sync";

export const runtime = "nodejs";
// IMAP/parser nécessitent Node natifs (TLS, Buffer) + temps de traitement.
export const maxDuration = 300;

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
    const result = await runImapSync();
    const duration_ms = Date.now() - start;

    if (result.totalTenants > 0) {
      console.log(
        `[cron:imap-sync] tenants=${result.totalTenants} ok=${result.okTenants} ` +
          `failed=${result.failedTenants} inserted=${result.totalInserted} ` +
          `duration_ms=${duration_ms}`,
      );
    }

    return NextResponse.json({
      ok: true,
      totalTenants: result.totalTenants,
      okTenants: result.okTenants,
      failedTenants: result.failedTenants,
      totalInserted: result.totalInserted,
      duration_ms,
      perTenant: result.perTenant,
    });
  } catch (err) {
    console.error("[cron:imap-sync] fatal", err);
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
