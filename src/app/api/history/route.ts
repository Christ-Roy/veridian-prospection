import { NextResponse } from "next/server";
import { getHistoryLeads } from "@/lib/queries";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const leads = await getHistoryLeads(200, tenantId);
  return NextResponse.json(leads);
}
