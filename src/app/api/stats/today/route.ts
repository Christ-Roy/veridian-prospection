import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

// GET /api/stats/today — count of prospects visited/contacted today
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const effectiveTid = tenantId ?? "00000000-0000-0000-0000-000000000000";
  const today = new Date().toISOString().split("T")[0];

  const result = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM outreach
    WHERE tenant_id = ${effectiveTid}::uuid
    AND last_visited >= ${today}
  `;

  return NextResponse.json({ today: Number(result[0].count) });
}
