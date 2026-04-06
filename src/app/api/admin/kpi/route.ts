/**
 * Admin API — KPI dashboard
 *
 * GET /api/admin/kpi?from=ISO&to=ISO
 *   → returns aggregates per workspace and per user in the tenant:
 *     - Outreach counts by status
 *     - Call count + total duration
 *     - Followup count (pending/done)
 *     - Conversion rate (gagne / total)
 *
 * Admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/user-context";
import { PrismaClient } from "@prisma/client";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseAdmin(url, key);
}

type OutreachAgg = { workspace_id: string | null; status: string; count: bigint };
type CallAgg = { workspace_id: string | null; n: bigint; total_seconds: bigint | null };
type FollowupAgg = { workspace_id: string | null; status: string; count: bigint };

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const from = fromStr ? new Date(fromStr) : null;
  const to = toStr ? new Date(toStr) : null;

  // 1) Workspaces in tenant
  const workspaces = await prisma.workspace.findMany({
    where: { tenantId: auth.ctx.tenantId },
    include: { members: true },
  });
  const wsIds = workspaces.map((w) => w.id);

  if (wsIds.length === 0) {
    return NextResponse.json({ workspaces: [], tenantId: auth.ctx.tenantId });
  }

  // 2) Outreach aggregates per workspace + status
  const outreachRows = await prisma.outreach.groupBy({
    by: ["workspaceId", "status"],
    where: {
      tenantId: auth.ctx.tenantId,
      workspaceId: { in: wsIds },
      ...(from || to
        ? {
            contactedDate: {
              ...(from ? { gte: from.toISOString() } : {}),
              ...(to ? { lte: to.toISOString() } : {}),
            },
          }
        : {}),
    },
    _count: { _all: true },
  });
  const outreachAgg: OutreachAgg[] = outreachRows.map((r) => ({
    workspace_id: r.workspaceId,
    status: r.status,
    count: BigInt(r._count._all),
  }));

  // 3) Call log aggregates per workspace
  const callRows = await prisma.callLog.groupBy({
    by: ["workspaceId"],
    where: {
      tenantId: auth.ctx.tenantId,
      workspaceId: { in: wsIds },
      ...(from || to
        ? {
            startedAt: {
              ...(from ? { gte: from.toISOString() } : {}),
              ...(to ? { lte: to.toISOString() } : {}),
            },
          }
        : {}),
    },
    _count: { _all: true },
    _sum: { durationSeconds: true },
  });
  const callAgg: CallAgg[] = callRows.map((r) => ({
    workspace_id: r.workspaceId,
    n: BigInt(r._count._all),
    total_seconds: r._sum.durationSeconds ? BigInt(r._sum.durationSeconds) : null,
  }));

  // 4) Followup aggregates per workspace + status
  const fupRows = await prisma.followup.groupBy({
    by: ["workspaceId", "status"],
    where: {
      tenantId: auth.ctx.tenantId,
      workspaceId: { in: wsIds },
    },
    _count: { _all: true },
  });
  const fupAgg: FollowupAgg[] = fupRows.map((r) => ({
    workspace_id: r.workspaceId,
    status: r.status,
    count: BigInt(r._count._all),
  }));

  // 5) Resolve user emails for memberships (best effort)
  const userIds = Array.from(
    new Set(workspaces.flatMap((w) => w.members.map((m) => m.userId)))
  );
  const emailMap = new Map<string, string>();
  if (userIds.length > 0) {
    const admin = getAdminClient();
    if (admin) {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      for (const u of data?.users ?? []) {
        if (userIds.includes(u.id)) emailMap.set(u.id, u.email ?? "");
      }
    }
  }

  // 6) Build per-workspace summary
  const result = workspaces.map((ws) => {
    const o = outreachAgg.filter((r) => r.workspace_id === ws.id);
    const c = callAgg.find((r) => r.workspace_id === ws.id);
    const f = fupAgg.filter((r) => r.workspace_id === ws.id);

    const outreachByStatus: Record<string, number> = {};
    let outreachTotal = 0;
    for (const r of o) {
      outreachByStatus[r.status] = Number(r.count);
      outreachTotal += Number(r.count);
    }
    const won = outreachByStatus["gagne"] ?? 0;
    const conversionRate = outreachTotal > 0 ? won / outreachTotal : 0;

    const followupByStatus: Record<string, number> = {};
    for (const r of f) followupByStatus[r.status] = Number(r.count);

    return {
      workspaceId: ws.id,
      name: ws.name,
      slug: ws.slug,
      leadsLimit: ws.leadsLimit,
      members: ws.members.map((m) => ({
        userId: m.userId,
        email: emailMap.get(m.userId) ?? "(unknown)",
        role: m.role,
      })),
      outreach: {
        total: outreachTotal,
        byStatus: outreachByStatus,
        won,
        conversionRate: Math.round(conversionRate * 10000) / 10000,
      },
      calls: {
        total: c ? Number(c.n) : 0,
        totalSeconds: c?.total_seconds ? Number(c.total_seconds) : 0,
      },
      followups: {
        byStatus: followupByStatus,
        total: Object.values(followupByStatus).reduce((a, b) => a + b, 0),
      },
    };
  });

  return NextResponse.json({
    tenantId: auth.ctx.tenantId,
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    workspaces: result,
  });
}
