/**
 * GET /api/status — detailed state snapshot for monitoring.
 *
 * Public, no auth. Used by the VPS monitoring scripts
 * (/opt/veridian/monitoring/prod-healthcheck.sh) to surface more signal
 * than the minimal /api/health route.
 *
 * Shape:
 *   {
 *     status: 'healthy' | 'degraded' | 'unhealthy',
 *     db: 'ok' | 'fail',
 *     supabase: 'ok' | 'fail' | 'not_configured',
 *     entreprises_count: number,
 *     outreach_count: number,
 *     followups_count: number,
 *     claude_activity_count: number,
 *     workspaces_count: number,
 *     twenty: 'ok' | 'fail' | 'not_configured',
 *     version: string,
 *     commit: string | null,
 *     uptime_s: number,
 *     timestamp: string,
 *     checks_ms: { db, supabase, twenty },
 *   }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";

const STARTED_AT = Date.now();

async function checkDb(): Promise<{ ok: boolean; ms: number; counts?: Record<string, number> }> {
  const start = Date.now();
  try {
    const ping = await prisma.$queryRaw<[{ ok: number }]>`SELECT 1 as ok`;
    if (ping[0]?.ok !== 1) return { ok: false, ms: Date.now() - start };

    // Batched counts in parallel
    const [entreprises, outreach, followups, claude, workspaces] = await Promise.all([
      prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) as c FROM entreprises`.catch(
        () => [{ c: BigInt(-1) }] as const
      ),
      prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) as c FROM outreach`.catch(
        () => [{ c: BigInt(-1) }] as const
      ),
      prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) as c FROM followups`.catch(
        () => [{ c: BigInt(-1) }] as const
      ),
      prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) as c FROM claude_activity`.catch(
        () => [{ c: BigInt(-1) }] as const
      ),
      prisma.$queryRaw<[{ c: bigint }]>`SELECT COUNT(*) as c FROM workspaces`.catch(
        () => [{ c: BigInt(-1) }] as const
      ),
    ]);

    return {
      ok: true,
      ms: Date.now() - start,
      counts: {
        entreprises: Number(entreprises[0].c),
        outreach: Number(outreach[0].c),
        followups: Number(followups[0].c),
        claude_activity: Number(claude[0].c),
        workspaces: Number(workspaces[0].c),
      },
    };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

async function checkSupabase(): Promise<{ status: "ok" | "fail" | "not_configured"; ms: number }> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { status: "not_configured", ms: 0 };
  const start = Date.now();
  try {
    const supabase = createClient(url, key);
    // Cheap call: head count on tenants
    const { error } = await supabase.from("tenants").select("id", { count: "exact", head: true });
    return { status: error ? "fail" : "ok", ms: Date.now() - start };
  } catch {
    return { status: "fail", ms: Date.now() - start };
  }
}

async function checkTwenty(): Promise<{ status: "ok" | "fail" | "not_configured"; ms: number }> {
  const url = process.env.TWENTY_API_URL;
  const key = process.env.TWENTY_API_KEY;
  if (!url || !key) return { status: "not_configured", ms: 0 };
  const start = Date.now();
  try {
    const res = await fetch(`${url}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
      // Cap at 3s to not slow down health probes
      signal: AbortSignal.timeout(3000),
    });
    return { status: res.ok ? "ok" : "fail", ms: Date.now() - start };
  } catch {
    return { status: "fail", ms: Date.now() - start };
  }
}

export async function GET() {
  const [db, supabase, twenty] = await Promise.all([checkDb(), checkSupabase(), checkTwenty()]);

  const allOk = db.ok && supabase.status !== "fail" && twenty.status !== "fail";
  const critical = !db.ok;
  const status: "healthy" | "degraded" | "unhealthy" = critical
    ? "unhealthy"
    : allOk
      ? "healthy"
      : "degraded";

  const body = {
    status,
    db: db.ok ? "ok" : "fail",
    supabase: supabase.status,
    twenty: twenty.status,
    entreprises_count: db.counts?.entreprises ?? null,
    outreach_count: db.counts?.outreach ?? null,
    followups_count: db.counts?.followups ?? null,
    claude_activity_count: db.counts?.claude_activity ?? null,
    workspaces_count: db.counts?.workspaces ?? null,
    version: process.env.NEXT_PUBLIC_APP_VERSION || process.env.npm_package_version || "unknown",
    commit: process.env.GIT_SHA || process.env.NEXT_PUBLIC_COMMIT_SHA || null,
    uptime_s: Math.round((Date.now() - STARTED_AT) / 1000),
    timestamp: new Date().toISOString(),
    checks_ms: { db: db.ms, supabase: supabase.ms, twenty: twenty.ms },
  };

  return NextResponse.json(body, { status: critical ? 503 : 200 });
}
