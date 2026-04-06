/**
 * Admin API — Members list
 *
 * GET   /api/admin/members → list all members of the tenant with activity counts
 * PATCH /api/admin/members → update a member's visibility_scope
 *                            body: { userId, workspaceId, visibilityScope: "all" | "own" }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, invalidateUserContext } from "@/lib/supabase/user-context";
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

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  // 1) All workspaces in this tenant
  const workspaces = await prisma.workspace.findMany({
    where: { tenantId: auth.ctx.tenantId },
    include: { members: true },
  });
  type Membership = {
    workspaceId: string;
    workspaceName: string;
    role: string;
    visibilityScope: string;
  };

  // 2) Flatten: build a map userId → { memberships: [...] }
  const byUser = new Map<string, { userId: string; memberships: Membership[] }>();

  for (const ws of workspaces) {
    for (const m of ws.members) {
      const entry = byUser.get(m.userId) ?? { userId: m.userId, memberships: [] };
      entry.memberships.push({
        workspaceId: ws.id,
        workspaceName: ws.name,
        role: m.role,
        visibilityScope: m.visibilityScope,
      });
      byUser.set(m.userId, entry);
    }
  }

  // 2b) Activity counts per user (tenant-scoped). Rows created before the
  //     user_id column was added remain NULL and are not attributed.
  const activeStatuses = [
    "contacte",
    "appele",
    "interesse",
    "rdv",
    "client",
    "rappeler",
    "relancer",
  ];

  const [outreachGrouped, outreachActiveGrouped, callLogsGrouped, claudeGrouped] =
    await Promise.all([
      prisma.outreach.groupBy({
        by: ["userId"],
        where: { tenantId: auth.ctx.tenantId, userId: { not: null } },
        _count: { _all: true },
      }),
      prisma.outreach.groupBy({
        by: ["userId"],
        where: {
          tenantId: auth.ctx.tenantId,
          userId: { not: null },
          status: { in: activeStatuses },
        },
        _count: { _all: true },
      }),
      prisma.callLog.groupBy({
        by: ["userId"],
        where: { tenantId: auth.ctx.tenantId, userId: { not: null } },
        _count: { _all: true },
      }),
      prisma.claudeActivity.groupBy({
        by: ["userId"],
        where: { tenantId: auth.ctx.tenantId, userId: { not: null } },
        _count: { _all: true },
      }),
    ]);

  const countByUser = (
    rows: Array<{ userId: string | null; _count: { _all: number } }>
  ): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.userId) m.set(r.userId, r._count._all);
    return m;
  };
  const outreachCounts = countByUser(outreachGrouped);
  const outreachActiveCounts = countByUser(outreachActiveGrouped);
  const callCounts = countByUser(callLogsGrouped);
  const claudeCounts = countByUser(claudeGrouped);

  // 3) Enrich with email from Supabase auth.users (batch)
  const userIds = Array.from(byUser.keys());
  const emailMap = new Map<string, string>();

  if (userIds.length > 0) {
    const admin = getAdminClient();
    if (admin) {
      // Supabase doesn't expose a bulk getByIds; we page list and filter.
      // For small tenants this is fine. For large, we'd switch to a DB join.
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      for (const u of data?.users ?? []) {
        if (userIds.includes(u.id)) emailMap.set(u.id, u.email ?? "");
      }
    }
  }

  // 4) Include the tenant owner (always admin, even without a workspace membership)
  const ownerId = auth.ctx.tenantOwnerId;
  if (ownerId && !byUser.has(ownerId)) {
    byUser.set(ownerId, { userId: ownerId, memberships: [] });
    if (!emailMap.has(ownerId)) {
      const admin = getAdminClient();
      if (admin) {
        const { data } = await admin.auth.admin.getUserById(ownerId);
        if (data?.user?.email) emailMap.set(ownerId, data.user.email);
      }
    }
  }

  const members = Array.from(byUser.values()).map((m) => ({
    userId: m.userId,
    email: emailMap.get(m.userId) ?? "(unknown)",
    isOwner: m.userId === ownerId,
    memberships: m.memberships,
    counts: {
      outreach: outreachCounts.get(m.userId) ?? 0,
      outreachActive: outreachActiveCounts.get(m.userId) ?? 0,
      calls: callCounts.get(m.userId) ?? 0,
      claude: claudeCounts.get(m.userId) ?? 0,
    },
  }));

  return NextResponse.json({ members, tenantId: auth.ctx.tenantId });
}

/**
 * PATCH /api/admin/members
 * Body: { userId, workspaceId, visibilityScope: "all" | "own" }
 * Updates the visibility_scope for a specific membership.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const userId: string | undefined = body.userId;
  const workspaceId: string | undefined = body.workspaceId;
  const visibilityScope: "all" | "own" =
    body.visibilityScope === "own" ? "own" : "all";

  if (!userId || !workspaceId) {
    return NextResponse.json(
      { error: "userId and workspaceId are required" },
      { status: 400 }
    );
  }

  // Security: workspace must belong to the admin's tenant
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, tenantId: auth.ctx.tenantId },
    select: { id: true },
  });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  await prisma.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId, userId } },
    data: { visibilityScope },
  });

  invalidateUserContext(userId);
  return NextResponse.json({ ok: true, userId, workspaceId, visibilityScope });
}
