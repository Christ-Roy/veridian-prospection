/**
 * GET /api/status — detailed state snapshot for monitoring.
 *
 * Public, no auth. Used by the VPS monitoring scripts
 * (/opt/veridian/monitoring/prod-healthcheck.sh) to surface more signal
 * than the minimal /api/health route.
 *
 * SÉCURITÉ — cette route est PUBLIQUE : elle NE DOIT PAS exposer les
 * volumes business (entreprises, outreach, workspaces…). Ça divulgue la
 * taille du business à n'importe qui (pentest T16 finding L1). Les
 * compteurs sont servis par GET /api/admin/stats, derrière requireAdmin().
 *
 * Shape:
 *   {
 *     status: 'healthy' | 'degraded' | 'unhealthy',
 *     db: 'ok' | 'fail',
 *     auth: 'ok' | 'fail',
 *     version: string,
 *     commit: string | null,
 *     uptime_s: number,
 *     timestamp: string,
 *     checks_ms: { db, auth },
 *   }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const STARTED_AT = Date.now();

async function checkDb(): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now();
  try {
    const ping = await prisma.$queryRaw<[{ ok: number }]>`SELECT 1 as ok`;
    return { ok: ping[0]?.ok === 1, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

async function checkAuth(): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now();
  try {
    // Auth.js v5 — vérifie que la table users (Prisma) répond
    await prisma.user.count();
    return { ok: true, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

export async function GET() {
  const [db, auth] = await Promise.all([checkDb(), checkAuth()]);

  const allOk = db.ok && auth.ok;
  const critical = !db.ok;
  const status: "healthy" | "degraded" | "unhealthy" = critical
    ? "unhealthy"
    : allOk
      ? "healthy"
      : "degraded";

  const body = {
    status,
    db: db.ok ? "ok" : "fail",
    auth: auth.ok ? "ok" : "fail",
    version: process.env.NEXT_PUBLIC_APP_VERSION || process.env.npm_package_version || "unknown",
    commit: process.env.GIT_SHA || process.env.NEXT_PUBLIC_COMMIT_SHA || null,
    uptime_s: Math.round((Date.now() - STARTED_AT) / 1000),
    timestamp: new Date().toISOString(),
    checks_ms: {
      db: db.ms,
      auth: auth.ms,
    },
  };

  return NextResponse.json(body, { status: critical ? 503 : 200 });
}
