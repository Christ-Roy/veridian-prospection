import { NextRequest, NextResponse } from "next/server";
import { getLeads } from "@/lib/queries";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId, getTenantProspectLimit } from "@/lib/supabase/tenant";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const prospectLimit = await getTenantProspectLimit(auth.user.id);
  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const pageSize = Math.min(200, Math.max(10, parseInt(sp.get("pageSize") ?? "50")));
  const sort = sp.get("sort") ?? "domain";
  const sortDir = sp.get("sortDir") === "desc" ? "desc" as const : "asc" as const;
  const deduplicate = sp.get("deduplicate") === "true";

  // Parse filters: ?f_domain=xxx&f_effectifs=11&f_effectifs=12
  const filters: Record<string, string> = {};

  // Use generic iteration to capture all keys
  const keys = new Set(Array.from(sp.keys()).filter(k => k.startsWith("f_")));

  for (const key of keys) {
    const values = sp.getAll(key).filter(Boolean);
    if (values.length > 0) {
      // Join multiple values with comma for the query handler
      filters[key.slice(2)] = values.join(",");
    }
  }

  const result = await getLeads({ page, pageSize, sort, sortDir, filters, deduplicate }, tenantId);

  // Enforce plan-based prospect limit
  const cappedTotal = Math.min(result.total, prospectLimit);
  const cappedTotalPages = Math.max(1, Math.ceil(cappedTotal / pageSize));

  // If requesting a page beyond the limit, return empty data
  const maxAllowedOffset = prospectLimit;
  const currentOffset = (page - 1) * pageSize;
  const cappedData = currentOffset >= maxAllowedOffset ? [] : result.data;

  return NextResponse.json({
    ...result,
    data: cappedData,
    total: cappedTotal,
    totalPages: cappedTotalPages,
    prospectLimit,
    limitReached: result.total > prospectLimit,
  }, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
