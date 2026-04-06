/**
 * Admin API — Historique d'un membre
 *
 * GET /api/admin/members/[userId]/history
 *   Renvoie les 20 derniers événements du user (outreach updates + call_log + claude_activity)
 *   Réponse : { events: [{ type, siren, title, at, detail }] } ordered DESC
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/user-context";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

type Event = {
  type: "outreach" | "call" | "claude";
  siren: string;
  title: string;
  detail?: string;
  at: string | null;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { userId } = await params;
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const LIMIT = 40;

  const [outreach, calls, claudeActs] = await Promise.all([
    prisma.outreach.findMany({
      where: { tenantId: auth.ctx.tenantId, userId },
      select: {
        siren: true,
        status: true,
        updatedAt: true,
        entreprise: { select: { denomination: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
    }),
    prisma.callLog.findMany({
      where: { tenantId: auth.ctx.tenantId, userId },
      select: {
        siren: true,
        direction: true,
        status: true,
        durationSeconds: true,
        startedAt: true,
        entreprise: { select: { denomination: true } },
      },
      orderBy: { startedAt: "desc" },
      take: LIMIT,
    }),
    prisma.claudeActivity.findMany({
      where: { tenantId: auth.ctx.tenantId, userId },
      select: {
        siren: true,
        activityType: true,
        title: true,
        createdAt: true,
        entreprise: { select: { denomination: true } },
      },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    }),
  ]);

  const events: Event[] = [];

  for (const o of outreach) {
    events.push({
      type: "outreach",
      siren: o.siren,
      title: `${o.entreprise?.denomination ?? o.siren} → ${o.status}`,
      at: o.updatedAt,
    });
  }
  for (const c of calls) {
    events.push({
      type: "call",
      siren: c.siren ?? "",
      title: `${c.direction === "outbound" ? "Appel sortant" : "Appel entrant"} — ${
        c.entreprise?.denomination ?? c.siren ?? "?"
      }`,
      detail: `${c.status}${c.durationSeconds ? ` · ${c.durationSeconds}s` : ""}`,
      at: c.startedAt,
    });
  }
  for (const a of claudeActs) {
    events.push({
      type: "claude",
      siren: a.siren,
      title: a.title || `${a.activityType} — ${a.entreprise?.denomination ?? a.siren}`,
      at: a.createdAt,
    });
  }

  // Sort DESC by date (string ISO ordering OK)
  events.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const limited = events.slice(0, 20);

  return NextResponse.json({ userId, events: limited });
}
