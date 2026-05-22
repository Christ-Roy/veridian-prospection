/**
 * GET /api/admin/stats — global business volume counters.
 *
 * Admin only. Holds the platform-wide counts (entreprises, outreach,
 * followups, claude_activity, workspaces) that used to be served by the
 * public /api/status route. Moved here so the size of the business is
 * not exposed to unauthenticated callers (audit T18 / pentest T16 L1).
 *
 * Shape:
 *   {
 *     entreprises_count: number | null,
 *     outreach_count: number | null,
 *     followups_count: number | null,
 *     claude_activity_count: number | null,
 *     workspaces_count: number | null,
 *     timestamp: string,
 *   }
 *
 * A count of -1 means the underlying COUNT query failed; null means the
 * whole DB batch failed.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let counts: Record<string, number> | null = null;
  try {
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
    counts = {
      entreprises: Number(entreprises[0].c),
      outreach: Number(outreach[0].c),
      followups: Number(followups[0].c),
      claude_activity: Number(claude[0].c),
      workspaces: Number(workspaces[0].c),
    };
  } catch {
    counts = null;
  }

  return NextResponse.json({
    entreprises_count: counts?.entreprises ?? null,
    outreach_count: counts?.outreach ?? null,
    followups_count: counts?.followups ?? null,
    claude_activity_count: counts?.claude_activity ?? null,
    workspaces_count: counts?.workspaces ?? null,
    timestamp: new Date().toISOString(),
  });
}
