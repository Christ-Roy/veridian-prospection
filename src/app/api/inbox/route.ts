import { NextRequest, NextResponse } from "next/server";
import { requireUser, getWorkspaceFilter } from "@/lib/auth/user-context";
import { isRateLimited } from "@/lib/rate-limit";
import {
  listInboxEmails,
  type InboxDirection,
  type InboxStatus,
} from "@/lib/queries/inbox";

const ALLOWED_DIRECTIONS: InboxDirection[] = ["in", "out", "all"];
const ALLOWED_STATUSES: InboxStatus[] = ["attached", "orphan", "all"];

function parseDirection(value: string | null): InboxDirection {
  if (value && (ALLOWED_DIRECTIONS as string[]).includes(value)) {
    return value as InboxDirection;
  }
  return "all";
}

function parseStatus(value: string | null): InboxStatus {
  if (value && (ALLOWED_STATUSES as string[]).includes(value)) {
    return value as InboxStatus;
  }
  return "all";
}

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  if (isRateLimited(`inbox:${auth.ctx.userId}`, 120, 60_000)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const direction = parseDirection(searchParams.get("direction"));
  const status = parseStatus(searchParams.get("status"));
  const cursor = searchParams.get("cursor");

  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50;

  const workspaceFilter = getWorkspaceFilter(auth.ctx);

  const result = await listInboxEmails({
    tenantId: auth.ctx.tenantId,
    workspaceFilter,
    direction,
    status,
    cursor,
    limit,
  });

  return NextResponse.json({
    items: result.items.map((item) => ({
      ...item,
      occurredAt: item.occurredAt.toISOString(),
    })),
    nextCursor: result.nextCursor,
    filters: { direction, status },
  });
}
