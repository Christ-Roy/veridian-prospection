import { NextRequest, NextResponse } from "next/server";
import { getLeadsByDomains } from "@/lib/queries";
import { exportToTwenty } from "@/lib/twenty";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const body = await request.json();
  const domains: string[] = body.domains;

  if (!Array.isArray(domains) || domains.length === 0) {
    return NextResponse.json({ error: "domains[] requis" }, { status: 400 });
  }

  if (domains.length > 500) {
    return NextResponse.json({ error: "Maximum 500 leads par export" }, { status: 400 });
  }

  if (!process.env.TWENTY_API_URL || !process.env.TWENTY_API_KEY) {
    return NextResponse.json(
      { error: "TWENTY_API_URL et TWENTY_API_KEY doivent être configurés dans .env.local" },
      { status: 500 }
    );
  }

  const leads = await getLeadsByDomains(domains, tenantId);

  if (leads.length === 0) {
    return NextResponse.json({ error: "Aucun lead trouvé pour ces domaines" }, { status: 404 });
  }

  const result = await exportToTwenty(leads);
  return NextResponse.json(result);
}
