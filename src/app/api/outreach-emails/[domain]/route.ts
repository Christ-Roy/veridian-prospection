import { NextRequest, NextResponse } from "next/server";
import { getOutreachEmails } from "@/lib/queries";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { domain } = await params;
  const emails = await getOutreachEmails(domain, tenantId);
  return NextResponse.json(emails);
}
