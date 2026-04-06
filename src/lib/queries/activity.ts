import { prisma, bigIntToNumber, tenantWhere } from "./shared";
import type { ClaudeActivity, ClaudeStats, Followup } from "../types";

// Workspace filter helper: null = no filter (admin), [] = empty set (member with no workspaces)
function workspaceWhere(workspaceFilter: string[] | null | undefined) {
  if (workspaceFilter === null || workspaceFilter === undefined) return {};
  return { workspaceId: { in: workspaceFilter } };
}

// --- Claude Activity ---

export async function getClaudeActivities(
  siren: string,
  tenantId: string | null = null,
  workspaceFilter: string[] | null = null,
): Promise<ClaudeActivity[]> {
  return await prisma.claudeActivity.findMany({
    where: {
      siren,
      tenantId: tenantId ?? undefined,
      ...workspaceWhere(workspaceFilter),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      siren: true,
      activityType: true,
      title: true,
      content: true,
      metadata: true,
      createdAt: true,
    },
  }) as unknown as ClaudeActivity[];
}

export async function addClaudeActivity(data: {
  siren: string;
  activity_type: string;
  title?: string;
  content: string;
  metadata?: string;
}, tenantId: string | null = null, workspaceId: string | null = null, userId: string | null = null): Promise<ClaudeActivity> {
  return await prisma.claudeActivity.create({
    data: {
      siren: data.siren,
      activityType: data.activity_type,
      title: data.title ?? null,
      content: data.content,
      metadata: data.metadata ?? null,
      tenantId,
      workspaceId,
      userId,
    },
  }) as unknown as ClaudeActivity;
}

export async function getClaudeStats(
  tenantId: string | null = null,
  workspaceFilter: string[] | null = null,
): Promise<ClaudeStats> {
  const tw = tenantWhere("claude_activity", tenantId);
  // Build workspace filter clause for the raw query
  let wsClause = "";
  if (workspaceFilter !== null) {
    if (workspaceFilter.length === 0) {
      wsClause = " AND FALSE";
    } else {
      const ids = workspaceFilter.map((w) => `'${w.replace(/'/g, "''")}'`).join(",");
      wsClause = ` AND workspace_id IN (${ids})`;
    }
  }
  const counts = await prisma.$queryRawUnsafe<[{
    total_analyzed: bigint;
    total_drafts: bigint;
    total_recommendations: bigint;
  }]>(`
    SELECT
      COUNT(DISTINCT CASE WHEN activity_type = 'analysis' THEN siren END) as total_analyzed,
      COUNT(CASE WHEN activity_type = 'email_draft' THEN 1 END) as total_drafts,
      COUNT(CASE WHEN activity_type = 'recommendation' THEN 1 END) as total_recommendations
    FROM claude_activity
    WHERE ${tw}${wsClause}
  `);

  const recent = await prisma.claudeActivity.findMany({
    where: {
      tenantId: tenantId ?? undefined,
      ...workspaceWhere(workspaceFilter),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      siren: true,
      activityType: true,
      title: true,
      content: true,
      metadata: true,
      createdAt: true,
    },
  }) as unknown as ClaudeActivity[];

  return {
    total_analyzed: bigIntToNumber(counts[0].total_analyzed),
    total_drafts: bigIntToNumber(counts[0].total_drafts),
    total_recommendations: bigIntToNumber(counts[0].total_recommendations),
    recent_activity: recent,
  };
}

export async function getClaudeAnalyzedCount(whereSql: string, whereParams: (string | number)[], tenantId: string | null = null): Promise<number> {
  const tw = tenantWhere("ca", tenantId);
  // Now counts SIREN in `entreprises` that have at least one claude_activity row
  const sql = `
    SELECT COUNT(DISTINCT e.siren) as count
    FROM entreprises e
    WHERE ${whereSql}
      AND EXISTS (SELECT 1 FROM claude_activity ca WHERE ca.siren = e.siren AND ${tw})
  `;
  const result = await prisma.$queryRawUnsafe<[{ count: bigint }]>(sql, ...whereParams);
  return bigIntToNumber(result[0].count);
}

export async function updateClaudeActivity(
  id: number,
  data: { content?: string; title?: string },
  tenantId: string | null = null,
  workspaceFilter: string[] | null = null,
): Promise<void> {
  const updateData: Record<string, string> = {};

  if (data.content !== undefined) {
    updateData.content = data.content;
  }
  if (data.title !== undefined) {
    updateData.title = data.title;
  }

  if (Object.keys(updateData).length === 0) return;

  await prisma.claudeActivity.updateMany({
    where: {
      id,
      tenantId: tenantId ?? undefined,
      ...workspaceWhere(workspaceFilter),
    },
    data: updateData,
  });
}

// --- Followups ---

export async function getFollowups(
  siren?: string,
  tenantId: string | null = null,
  workspaceFilter: string[] | null = null,
): Promise<Followup[]> {
  return await prisma.followup.findMany({
    where: {
      ...(siren ? { siren } : {}),
      tenantId: tenantId ?? undefined,
      ...workspaceWhere(workspaceFilter),
    },
    orderBy: { scheduledAt: "asc" },
    select: {
      id: true,
      siren: true,
      scheduledAt: true,
      status: true,
      note: true,
      createdAt: true,
    },
  }) as unknown as Followup[];
}

export async function addFollowup(
  data: { siren: string; scheduled_at: string; note?: string },
  tenantId: string | null = null,
  workspaceId: string | null = null,
): Promise<Followup> {
  return await prisma.followup.create({
    data: {
      siren: data.siren,
      scheduledAt: data.scheduled_at,
      status: "pending",
      note: data.note ?? null,
      tenantId,
      workspaceId,
    },
  }) as unknown as Followup;
}

export async function updateFollowup(
  id: number,
  data: { status?: string; note?: string },
  tenantId: string | null = null,
  workspaceFilter: string[] | null = null,
): Promise<void> {
  const updateData: Record<string, string> = {};

  if (data.status !== undefined) {
    updateData.status = data.status;
  }
  if (data.note !== undefined) {
    updateData.note = data.note;
  }

  if (Object.keys(updateData).length === 0) return;

  await prisma.followup.updateMany({
    where: {
      id,
      tenantId: tenantId ?? undefined,
      ...workspaceWhere(workspaceFilter),
    },
    data: updateData,
  });
}

// --- Outreach Emails ---

export interface OutreachEmail {
  id: number;
  siren: string;
  to_email: string;
  from_email: string;
  subject: string;
  body_text: string;
  sent_at: string;
  message_id: string | null;
  status: string;
}

export async function addOutreachEmail(data: {
  siren: string;
  to_email: string;
  from_email?: string;
  subject: string;
  body_text: string;
  message_id?: string;
}, tenantId: string | null = null): Promise<OutreachEmail> {
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  return await prisma.outreachEmail.create({
    data: {
      siren: data.siren,
      toEmail: data.to_email,
      fromEmail: data.from_email ?? "robert.brunon@veridian.site",
      subject: data.subject,
      bodyText: data.body_text,
      sentAt: now,
      messageId: data.message_id ?? null,
      tenantId,
    },
  }) as unknown as OutreachEmail;
}

export async function getOutreachEmails(siren: string, tenantId: string | null = null): Promise<OutreachEmail[]> {
  return await prisma.outreachEmail.findMany({
    where: { siren, tenantId: tenantId ?? undefined },
    orderBy: { sentAt: "desc" },
  }) as unknown as OutreachEmail[];
}
