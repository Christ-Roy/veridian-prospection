/**
 * Admin API — Pipeline d'un membre
 *
 * GET /api/admin/members/[userId]/pipeline
 *   Renvoie les outreach du user groupés par status, filtrés sur le tenant courant.
 *   Réponse : { groups: [{ status, count, items: [{ siren, denomination, updatedAt }] }] }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/user-context";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

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

  // Outreach owned by this user in the admin's tenant
  const rows = await prisma.outreach.findMany({
    where: {
      tenantId: auth.ctx.tenantId,
      userId,
    },
    select: {
      siren: true,
      status: true,
      updatedAt: true,
      entreprise: { select: { denomination: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  // Group by status
  const map = new Map<
    string,
    { status: string; count: number; items: Array<{ siren: string; denomination: string | null; updatedAt: string | null }> }
  >();
  for (const r of rows) {
    const key = r.status || "a_contacter";
    const entry =
      map.get(key) ?? { status: key, count: 0, items: [] };
    entry.count++;
    if (entry.items.length < 25) {
      entry.items.push({
        siren: r.siren,
        denomination: r.entreprise?.denomination ?? null,
        updatedAt: r.updatedAt,
      });
    }
    map.set(key, entry);
  }

  const groups = Array.from(map.values()).sort((a, b) => b.count - a.count);
  return NextResponse.json({ userId, total: rows.length, groups });
}
