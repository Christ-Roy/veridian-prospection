import { NextRequest, NextResponse } from "next/server";
import { getFollowups, addFollowup } from "@/lib/queries";
import { requireAuth } from "@/lib/supabase/api-auth";
import { getTenantId } from "@/lib/supabase/tenant";
import { getWorkspaceScope } from "@/lib/supabase/user-context";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { filter } = await getWorkspaceScope();
  const { searchParams } = new URL(request.url);
  // Accept both ?siren= and legacy ?domain= (which now carries a SIREN value)
  const siren = searchParams.get("siren") ?? searchParams.get("domain") ?? undefined;

  const followups = await getFollowups(siren, tenantId, filter);

  return NextResponse.json(followups, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const tenantId = await getTenantId(auth.user.id);
  const { insertId } = await getWorkspaceScope();
  const body = await request.json();

  // Accept either `siren` or legacy `domain` key (both now carry a SIREN value)
  const siren: string | undefined = body.siren ?? body.domain;
  const { scheduled_at, note } = body;

  if (!siren || !scheduled_at) {
    return NextResponse.json(
      { error: "siren and scheduled_at are required" },
      { status: 400 }
    );
  }

  try {
    const followup = await addFollowup({ siren, scheduled_at, note }, tenantId, insertId);
    return NextResponse.json(followup, { status: 201 });
  } catch (error) {
    console.error("Erreur creation followup:", error);
    return NextResponse.json(
      { error: `Erreur: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
