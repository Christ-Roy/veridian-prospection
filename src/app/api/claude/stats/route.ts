import { NextResponse } from "next/server";
import { getClaudeStats } from "@/lib/queries";
import { cached } from "@/lib/cache";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { filter } = await getWorkspaceScope();
  const cacheKeyWs = filter === null ? "all" : filter.slice().sort().join(",");
  const cacheKey = `claude-stats-${tenantId ?? "null"}-${cacheKeyWs}`;
  const stats = await cached(cacheKey, 60 * 1000, () => getClaudeStats(tenantId, filter));
  return NextResponse.json(stats, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
