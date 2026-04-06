import { NextRequest, NextResponse } from "next/server";
import { getQualifications, updateQualification } from "@/lib/twenty";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";

// GET /api/twenty/qualification?domains=a.fr,b.fr
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  // TODO: pass tenantId when query supports it
  await getTenantId(auth.user.id);

  const domainsParam = request.nextUrl.searchParams.get("domains");
  if (!domainsParam) {
    return NextResponse.json({ error: "domains param requis" }, { status: 400 });
  }

  const domains = domainsParam.split(",").map((d) => d.trim()).filter(Boolean);
  if (domains.length === 0) {
    return NextResponse.json({ data: [] });
  }

  try {
    const data = await getQualifications(domains);
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

// PUT /api/twenty/qualification { personId, qualification }
export async function PUT(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  // TODO: pass tenantId when query supports it
  await getTenantId(auth.user.id);

  const body = await request.json();
  const { personId, qualification } = body;

  if (!personId || qualification === undefined) {
    return NextResponse.json({ error: "personId et qualification requis" }, { status: 400 });
  }

  if (typeof qualification !== "number" || qualification < 0 || qualification > 1) {
    return NextResponse.json({ error: "qualification doit etre entre 0 et 1" }, { status: 400 });
  }

  try {
    await updateQualification(personId, qualification);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
