import { NextResponse } from "next/server";
import { getStats } from "@/lib/queries";
import { cached } from "@/lib/cache";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const cacheKey = `stats-${tenantId ?? "null"}`;
  const stats = await cached(cacheKey, 5 * 60 * 1000, () => getStats(tenantId));
  return NextResponse.json(stats, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
