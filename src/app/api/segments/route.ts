import { NextResponse } from "next/server";
import { getAllSegments } from "@/lib/segments";
import { getAllSegmentCounts } from "@/lib/queries";
import { cached } from "@/lib/cache";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const segments = getAllSegments();
  const cacheKey = `segment-counts-${tenantId ?? "null"}`;
  const counts = await cached(cacheKey, 10 * 60 * 1000, () => getAllSegmentCounts(tenantId));

  const tree = segments.map(s => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    type: s.type,
    count: counts[s.id] ?? 0,
    parentId: s.id.includes("/") ? s.id.split("/").slice(0, -1).join("/") : null,
  }));

  return NextResponse.json(tree, {
    headers: { "Cache-Control": "private, max-age=600" },
  });
}
