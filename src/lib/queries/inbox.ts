import { prisma } from "@/lib/prisma";

export type InboxDirection = "in" | "out" | "all";
export type InboxStatus = "attached" | "orphan" | "all";

export interface InboxListParams {
  tenantId: string;
  workspaceFilter: string[] | null;
  direction?: InboxDirection;
  status?: InboxStatus;
  cursor?: string | null;
  limit?: number;
}

export interface InboxItem {
  id: string;
  direction: string;
  siren: string | null;
  entrepriseName: string | null;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  subject: string | null;
  bodyPreview: string | null;
  occurredAt: Date;
  sentStatus: string;
}

export interface InboxListResult {
  items: InboxItem[];
  nextCursor: string | null;
}

const MAX_LIMIT = 100;

function normalizeLimit(limit: number | undefined): number {
  if (!limit || limit <= 0) return 50;
  return Math.min(limit, MAX_LIMIT);
}

function buildPreview(text: string | null, html: string | null): string | null {
  const raw = text ?? (html ? html.replace(/<[^>]+>/g, " ") : null);
  if (!raw) return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
}

export async function listInboxEmails(
  params: InboxListParams,
): Promise<InboxListResult> {
  const limit = normalizeLimit(params.limit);
  const direction =
    params.direction === "in" || params.direction === "out"
      ? params.direction
      : "all";
  const status =
    params.status === "attached" || params.status === "orphan"
      ? params.status
      : "all";

  const where: Record<string, unknown> = { tenantId: params.tenantId };
  if (params.workspaceFilter) {
    where.workspaceId = { in: params.workspaceFilter };
  }
  if (direction === "in") where.direction = "incoming";
  if (direction === "out") where.direction = "outgoing";
  if (status === "attached") where.siren = { not: null };
  if (status === "orphan") where.siren = null;

  // Cursor: encoded as `${isoTimestamp}|${id}` for stable pagination on
  // (occurredAt desc, id desc). occurredAt = sentAt ?? createdAt.
  if (params.cursor) {
    const decoded = decodeCursor(params.cursor);
    if (decoded) {
      where.OR = [
        { sentAt: { lt: decoded.ts } },
        { sentAt: decoded.ts, id: { lt: decoded.id } },
        { sentAt: null, createdAt: { lt: decoded.ts } },
      ];
    }
  }

  const rows = await prisma.leadEmail.findMany({
    where,
    take: limit + 1,
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      direction: true,
      siren: true,
      fromEmail: true,
      fromName: true,
      toEmails: true,
      subject: true,
      bodyText: true,
      bodyHtml: true,
      sentAt: true,
      sentStatus: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;

  const sirens = Array.from(
    new Set(sliced.map((r) => r.siren).filter((s): s is string => !!s)),
  );
  const entreprises = sirens.length
    ? await prisma.entreprise.findMany({
        where: { siren: { in: sirens } },
        select: { siren: true, denomination: true },
      })
    : [];
  const nameMap = new Map(entreprises.map((e) => [e.siren, e.denomination]));

  const items: InboxItem[] = sliced.map((r) => {
    const occurredAt = r.sentAt ?? r.createdAt;
    return {
      id: r.id,
      direction: r.direction,
      siren: r.siren,
      entrepriseName: r.siren ? nameMap.get(r.siren) ?? null : null,
      fromEmail: r.fromEmail,
      fromName: r.fromName,
      toEmails: r.toEmails,
      subject: r.subject,
      bodyPreview: buildPreview(r.bodyText, r.bodyHtml),
      occurredAt,
      sentStatus: r.sentStatus,
    };
  });

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = sliced[sliced.length - 1];
    const ts = last.sentAt ?? last.createdAt;
    nextCursor = encodeCursor(ts, last.id);
  }

  return { items, nextCursor };
}

export function encodeCursor(ts: Date, id: string): string {
  const raw = `${ts.toISOString()}|${id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export function decodeCursor(
  cursor: string,
): { ts: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [iso, id] = raw.split("|");
    if (!iso || !id) return null;
    const ts = new Date(iso);
    if (Number.isNaN(ts.getTime())) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

export interface AttachInboxEmailArgs {
  leadEmailId: string;
  siren: string;
  tenantId: string;
  workspaceFilter: string[] | null;
}

export type AttachInboxResult =
  | { ok: true; previousSiren: string | null }
  | { ok: false; code: "not_found" | "forbidden" | "siren_not_found" };

export async function attachInboxEmail(
  args: AttachInboxEmailArgs,
): Promise<AttachInboxResult> {
  const existing = await prisma.leadEmail.findUnique({
    where: { id: args.leadEmailId },
    select: { id: true, tenantId: true, workspaceId: true, siren: true },
  });
  if (!existing) return { ok: false, code: "not_found" };
  if (existing.tenantId !== args.tenantId) {
    return { ok: false, code: "forbidden" };
  }
  if (
    args.workspaceFilter &&
    existing.workspaceId &&
    !args.workspaceFilter.includes(existing.workspaceId)
  ) {
    return { ok: false, code: "forbidden" };
  }

  const entreprise = await prisma.entreprise.findUnique({
    where: { siren: args.siren },
    select: { siren: true },
  });
  if (!entreprise) return { ok: false, code: "siren_not_found" };

  await prisma.leadEmail.update({
    where: { id: args.leadEmailId },
    data: { siren: args.siren },
  });

  return { ok: true, previousSiren: existing.siren };
}
