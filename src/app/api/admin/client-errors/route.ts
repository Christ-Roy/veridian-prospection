/**
 * GET /api/admin/client-errors — aggregated view of client-side JS errors.
 *
 * Admin only. Returns the top dedupeKeys by total count over the requested
 * window (default 7d), plus a sample stack/url/message per group.
 *
 * Shape:
 *   {
 *     since: ISO string,
 *     totalGroups: number,
 *     groups: Array<{
 *       dedupeKey: string,
 *       totalCount: number,
 *       firstSeen: ISO,
 *       lastSeen: ISO,
 *       message: string,
 *       url: string | null,
 *       stack: string | null,
 *     }>,
 *   }
 *
 * Cf. ticket 2026-05-23-persist-client-errors-db.md.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/user-context";
import { prisma } from "@/lib/prisma";

const DEFAULT_WINDOW_DAYS = 7;
const MAX_GROUPS = 100;

function parseSince(searchParams: URLSearchParams): Date {
  const raw = searchParams.get("since");
  if (raw) {
    const m = raw.match(/^(\d+)([dhm])$/);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2];
      const ms = unit === "d" ? n * 86_400_000 : unit === "h" ? n * 3_600_000 : n * 60_000;
      return new Date(Date.now() - ms);
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000);
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const since = parseSince(searchParams);
  const rawLimit = searchParams.get("limit");
  const parsedLimit = rawLimit === null ? 50 : parseInt(rawLimit, 10);
  const limit = Math.min(
    Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1),
    MAX_GROUPS,
  );

  const grouped = await prisma.clientError.groupBy({
    by: ["dedupeKey"],
    where: { occurredAt: { gte: since } },
    _sum: { count: true },
    _min: { occurredAt: true, message: true },
    _max: { lastSeenAt: true },
    orderBy: { _sum: { count: "desc" } },
    take: limit,
  });

  const dedupeKeys = grouped.map((g) => g.dedupeKey);

  // Pull one sample row per dedupeKey (latest occurrence) to expose
  // message / stack / url for the admin UI.
  const samples = dedupeKeys.length
    ? await prisma.clientError.findMany({
        where: { dedupeKey: { in: dedupeKeys } },
        orderBy: { lastSeenAt: "desc" },
        select: {
          dedupeKey: true,
          message: true,
          stack: true,
          url: true,
        },
      })
    : [];

  const sampleByKey = new Map<string, (typeof samples)[number]>();
  for (const s of samples) {
    if (!sampleByKey.has(s.dedupeKey)) sampleByKey.set(s.dedupeKey, s);
  }

  const groups = grouped.map((g) => {
    const sample = sampleByKey.get(g.dedupeKey);
    return {
      dedupeKey: g.dedupeKey,
      totalCount: g._sum.count ?? 0,
      firstSeen: g._min.occurredAt?.toISOString() ?? null,
      lastSeen: g._max.lastSeenAt?.toISOString() ?? null,
      message: sample?.message ?? g._min.message ?? "",
      url: sample?.url ?? null,
      stack: sample?.stack ?? null,
    };
  });

  return NextResponse.json({
    since: since.toISOString(),
    totalGroups: groups.length,
    groups,
  });
}
